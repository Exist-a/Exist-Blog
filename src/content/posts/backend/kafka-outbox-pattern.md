---
title: Kafka Outbox 模式:为什么不能一边写库一边发消息
date: 2026-09-14
excerpt: 在业务事务里同时写数据库和发 Kafka 消息,几乎一定会出现双写不一致。Outbox 模式把消息当成数据落进同一张表,再交给独立 relay 转发,是最朴素也最稳的解法。
category: backend
tags: [api]
---

# Kafka Outbox 模式:为什么不能一边写库一边发消息

我们在写后端服务的时候,经常遇到一种需求:**改完业务数据之后,要往 Kafka 发一条事件,通知下游**。比如订单状态从「待支付」变成「已支付」,除了把订单表里的状态改掉,还要发一条 `OrderPaid` 事件,让库存、积分、营销等服务各自去消费。

看起来很简单 —— 先 `UPDATE orders SET status='paid'`,再 `producer.send(orderPaidEvent)`,这两步顺序执行不就完事了?

问题就出在这个「不就完事了」上。**数据库和 Kafka 是两套独立的系统,没有任何一个事务能同时框住它们。** 这一篇我们就围绕这个问题展开,讲讲 Outbox 模式是怎么解决双写不一致的。

## 一、双写不一致到底长什么样

### 1.1 两个具体的翻车场景

**场景 A:先发消息后写库**

```text
1. producer.send(orderPaidEvent)   # Kafka 收到事件,下游开始消费
2. UPDATE orders SET status='paid' # 数据库这一步挂了
```

下游已经把「订单已支付」消费掉了 —— 库存去锁了、积分去加了 —— 但数据库里订单状态还是「待支付」。用户来刷新页面看到没支付,会再付一次。

**场景 B:先写库后发消息**

```text
1. UPDATE orders SET status='paid' # 库写成功,事务提交
2. producer.send(orderPaidEvent)   # 这步网络抖动,生产者重试也失败
```

数据库里订单已经支付,但 Kafka 里没有事件。下游永远不知道这笔订单要处理,直到用户投诉。

不管先发还是后发,**只要这两步不在同一个事务里,就一定有一个窗口期会出现「A 系统成功、B 系统失败」的不一致**。

### 1.2 那用分布式事务把它们绑一起呢

有同学会说,上 2PC / XA 呢?理论上,两阶段提交可以同时跨住 MySQL 和 Kafka,但实际上没人这么干:

- Kafka 的事务协议和 XA 不是一套东西,中间件适配成本高
- 2PC 在 coordinator 故障时会长时间锁住资源,延迟和可用性都差
- TCC、Seata 这类方案需要业务代码配合改写,改动面太大

更关键的是,**我们其实不需要「严格同时」,只需要「最终一致 + 不丢不重」**。Outbox 模式就是冲着这个目标去的。

## 二、Outbox 的核心思路:把消息也当成数据

### 2.1 思路一句话

**把要发的事件,作为一行数据,跟业务数据在同一个数据库事务里落盘。** 之后由一个独立的 relay 进程,把这张表里的事件读出来转发到 Kafka。

这样一来,「写业务表」和「写事件」变成了对**同一个数据库**的两次 `INSERT`,天然在一个事务里,要么一起成功、要么一起回滚。Kafka 那边的发送延迟、失败、重试,就跟数据库事务解耦了。

### 2.2 整体结构

四个角色:

| 角色 | 职责 |
|---|---|
| 业务服务 | 同一个事务里写业务表 + outbox 表 |
| outbox 表 | 暂存待发事件,本质就是一张队列表 |
| relay 进程 | 定时读 outbox 表,把事件发到 Kafka,然后标记已发 |
| Kafka | 事件总线,转发给下游消费者 |

可以看到,**数据库是单一事实来源**,Kafka 只是事件的复制通道。即便 relay 挂了、消息丢了,事件还在 outbox 表里,迟早会被发出去。

## 三、outbox 表该怎么设计

### 3.1 最小字段集

一张能用的 outbox 表至少要有这些字段:

```sql
CREATE TABLE outbox_events (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  aggregate_type  VARCHAR(64)  NOT NULL,  -- 比如 "Order"
  aggregate_id    VARCHAR(64)  NOT NULL,  -- 比如订单号
  event_type      VARCHAR(64)  NOT NULL,  -- 比如 "OrderPaid"
  payload         JSON         NOT NULL,  -- 事件完整快照
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_at    TIMESTAMP(3) NULL       -- NULL 表示还没发出去
);

CREATE INDEX idx_unpublished
  ON outbox_events (created_at)
  WHERE published_at IS NULL;  -- 注意:MySQL 不支持 partial index,这里只是示意
```

关键字段:

- **`aggregate_type` / `aggregate_id`**:定位这条事件属于哪个业务实体,消费端可以用来做幂等和排序
- **`payload`**:存放事件的**完整快照**,不是只放一个 id 然后让消费端去反查库 —— 消费端拿到事件应该能离线工作,不应该再依赖业务库
- **`published_at`**:发完就填上,这样 relay 只要 `WHERE published_at IS NULL` 就知道还有谁没发出去

### 3.2 payload 用 JSON 还是结构化列

小型项目直接用 JSON 字符串最省事,跨语言、跨版本都好兼容:

```json
{
  "orderId": "2026091400123",
  "userId": 10086,
  "paidAt": "2026-09-14T10:23:45.123Z",
  "amount": 199.00
}
```

如果事件结构稳定、对存储敏感,可以拆成独立列。但经验上,**事件结构会随业务演进而变,用 JSON 留出兼容性更安全**。

## 四、最小可运行的 relay

### 4.1 轮询的骨架

relay 的逻辑其实就三步:查未发的、发出去、标记已发。

```text
loop every 100ms:
    batch = SELECT * FROM outbox_events
            WHERE published_at IS NULL
            ORDER BY id
            LIMIT 100
            FOR UPDATE SKIP LOCKED

    for event in batch:
        try:
            producer.send(event.aggregate_id, event.payload)
            UPDATE outbox_events
               SET published_at = NOW()
             WHERE id = event.id
        except:
            # 发送失败,留 NULL,下一轮重试
            log(event.id, "send failed")
```

这里最关键的一行是 **`FOR UPDATE SKIP LOCKED`**。

### 4.2 为什么必须 `SKIP LOCKED`

部署多份 relay 实例(为了高可用)是常见做法。如果不用 `SKIP LOCKED`:

- relay A 锁住了一行 `id=100`,正在发
- relay B 也查到 `id=100`,想加锁,等 A 释放
- A 发完提交,锁释放
- B 拿到锁,发现 `published_at` 已经被 A 填上了 —— 这时应该跳过

`SKIP LOCKED` 让 B 在 A 锁住的那一刻就**直接跳过这行去处理别的**,省掉了等待,也避免重复发送的逻辑漏洞。

> PostgreSQL / MySQL 8.0+ / 主流商用数据库都支持 `SKIP LOCKED`,这是现代 outbox relay 的标配。

### 4.3 发送失败怎么办

注意上面 `try/except` 里**没有把 `published_at` 填上**。发送失败的事件会留在 `published_at IS NULL` 的集合里,下一轮继续被捞起来重试。

这里有几个细节要注意:

- **Kafka producer 要配幂等**(`enable.idempotence=true`),否则重试期间下游可能收到重复
- **消息里带一个 `event_id`**(就是 outbox 表的 `id`),消费端用来做去重
- 如果是**永久性失败**(比如 payload 序列化错误),光靠重试没用 —— 实操中会给 `outbox_events` 加一个 `retry_count` 和 `dead_letter_at`,超过阈值移到死信队列,但那是另一个话题了

## 五、消费端要配套做什么

### 5.1 至少一次 + 消费端幂等

outbox + relay 链路整体是 **at-least-once(至少一次)** 的:

- relay 发了消息、还没来得及 `UPDATE published_at` 就进程崩了
- 下一次 relay 重发这一条
- 下游就会收到两次

所以消费端必须**幂等**:同一个 `event_id` 处理一次和一百次,结果一样。

最常见的做法:

```sql
-- 处理事件前先插入一条占位记录
INSERT INTO processed_events (event_id, processed_at)
VALUES (?, NOW())
ON DUPLICATE KEY UPDATE event_id = event_id;  -- 已存在则跳过

-- 然后再做真正的业务处理
```

只要 `processed_events.event_id` 是唯一键,重复事件就会被这一步挡住,不会进入下游业务逻辑。

### 5.2 同 aggregate 的顺序问题

Kafka 分区内是有序的,但 outbox relay 转发时如果用 `aggregate_id` 做 partition key,**同一个订单的事件就会落进同一个分区,顺序就保住了**。

```text
relay 发事件时:
    key   = event.aggregate_id   # 比如 orderId
    value = event.payload
```

下游消费者用单线程消费每个分区,就能保证同一个订单的 `OrderCreated → OrderPaid → OrderShipped` 不会被乱序处理。

跨 aggregate 的顺序 —— 比如不同订单之间谁先谁后 —— Kafka 不保证,也**不需要保证**,因为它们本来就没业务上的先后关系。

## 六、这套模式的代价与替代

### 6.1 代价是什么

把账算清楚才能上生产。Outbox 模式带来三件事:

1. **多一张 outbox 表**:写业务时多一次 `INSERT`,事务里多一份开销
2. **多一个 relay 进程**:要部署、要监控、要做高可用
3. **端到端是至少一次**:消费端必须做幂等,这套要落到每个下游服务的代码里

对于大多数业务系统来说,这三点都是可以接受的;但如果团队规模小、想用现成方案,这套自研链路确实有上手成本。

### 6.2 想再近实时:CDC

relay 默认是轮询,延迟取决于轮询周期,通常在**几百毫秒到秒级**。如果业务对延迟敏感,可以换成 **CDC(Change Data Capture)**:

- 在 MySQL 上开 binlog
- 部署 Debezium 之类的工具订阅 binlog
- Debezium 直接把 `outbox_events` 的 INSERT 转成 Kafka 消息

CDC 的好处是**延迟能做到亚秒级、relay 不用自己写**;代价是要运维一套 binlog 订阅链路,对小项目偏重。多数团队从轮询版 outbox 起步,等业务量起来再考虑 CDC,是个比较稳的演进路径。

## 小结

> 把要发的消息当成一行业务数据,跟业务表一起写在同一个事务里,再交给一个独立的 relay 进程转发到 Kafka —— 用「数据落盘」换「最终一致」。

- **双写不一致的根源**:数据库和 Kafka 是两套系统,没有任何原生事务能同时跨住
- **Outbox 的核心**:把消息也当成数据,业务表 + outbox 表同事务写入
- **relay 的关键**:用 `FOR UPDATE SKIP LOCKED` 让多实例并发安全地读 outbox
- **消费端必须幂等**:链路整体是至少一次,`event_id` 配 `processed_events` 表是最常见的去重手段
- **顺序保证**:用 `aggregate_id` 做 Kafka partition key,同业务实体的事件落到同一分区
- **延迟敏感场景再考虑 CDC**:轮询版先落地,延迟到瓶颈再上 Debezium 之类
