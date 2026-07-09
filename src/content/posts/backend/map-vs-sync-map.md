---
title: Go 中 map 与 sync.Map 的区别
date: 2026-07-09
excerpt: 原生 map 的并发陷阱、互斥锁的代价，以及 sync.Map 用"读表+脏表"双结构实现的读写分离思想。
category: backend
tags: [go]
---

Go 是一门原生支持高并发的语言，使用它构建应用时，几乎绕不开多个 goroutine 同时访问同一份数据这个场景。学过数据库的同学对这类问题并不陌生——脏读、幻读、不可重复读，本质上都是并发访问共享资源带来的副作用，MySQL 用锁机制去解决它；Go 这边则把同样的问题摆在了我们常用的 `map` 面前。

## 引言

## 一、原生 map 并不是并发安全的

Go 内置的 `map` **不**支持并发读写。如果不借助锁或信号量，多个 goroutine 同时对同一个 `map` 写入，Go 运行时会直接抛出 `fatal error`，这个错误**无法被** **`recover`** **捕获**，进程会被强制终止。

```go
package main

import (
	"sync"
)

func main() {
	m := make(map[int]int)
	var wg sync.WaitGroup

	// 启动 100 个 goroutine 并发写入 map
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(key int) {
			defer wg.Done()
			m[key] = key // 并发写操作
		}(i)
	}

	wg.Wait()
}
```

运行后会得到类似这样的输出（堆栈信息因机器而异）：

```text
fatal error: concurrent map writes

goroutine 18 [running]:
runtime.throw({0x47d9e0?, 0x0?})
	/usr/local/go/src/runtime/panic.go:1041 +0x5fp
runtime.mapassign(0x0?, 0xc0000a0060?, 0x0?)
	/usr/local/go/src/runtime/map.go:540 +0x55p
main.main.func1(0x1)
	/tmp/main.go:18 +0x2ap
...
```

这会触发运行时的 `fatal error`，无法像普通 `panic` 一样被捕获。

## 二、最直接的解法：自己加锁

如果你的使用场景就是并发读写都有且频率差不多，最稳妥的做法还是 `sync.Mutex`（或 `sync.RWMutex`）包一层：

```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	m := make(map[int]int)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(key int) {
			defer wg.Done()

			mu.Lock()         // 进入临界区
			defer mu.Unlock() // 退出时释放锁（defer 保证异常也能释放）

			m[key] = key
		}(i)
	}

	wg.Wait()
	fmt.Println("map 长度：", len(m)) // 稳定输出 100，不会 panic
}
```

这段代码每次只允许一个 goroutine 进入临界区，逻辑最简单，也最容易理解。它的代价是**所有读和写都要抢同一把锁**，只要并发量稍微大一点，锁竞争就会成为瓶颈。

那么有没有一种方式，能让读多写少场景下的读路径不抢锁？这就是 `sync.Map` 要解决的问题。

## 三、sync.Map：用空间换时间

Go 1.9 引入 `sync.Map`，目标是提供一个**开箱即用**的并发安全 `map`，同时尽量降低"读多写少"场景下的锁开销。

它的核心思想一句话就能概括：**用两张表把"读路径"和"写路径"分开**。

### 3.1 内部结构

`sync.Map` 在源码（`src/sync/map.go`）中长这样（以 Go 1.22 为例）：

```go
type Map struct {
	mu      Mutex
	read    atomic.Pointer[readOnly]
	dirty   map[any]*entry
	misses  int
}

type readOnly struct {
	m       map[any]*entry
	amended bool
}

type entry struct {
	p atomic.Pointer[any]
}
```

让我们逐个字段来看：

- `mu`：互斥锁，**只**用来保护 `dirty` 的访问以及 `read` 自身的整体替换。
- `read`：`atomic.Pointer[readOnly]`，指向**只读**的那张表。读路径绝大多数时候都在用它。
- `dirty`：需要加锁才能访问的"脏表"，承载新增的 key。
- `misses`：从 `read` 升级成 `dirty` 那次之后，**读未命中并降级到** **`dirty`** **查询**的次数计数。达到一定阈值后会触发提升。

辅助类型：

- `readOnly.m`：只读表的实际 map。
- `readOnly.amended`：**dirty 表里是否包含了 read 表中不存在的 key**。这是一个针对整张表的标志位，不是"本次查询的 key 在不在 read 里"。
- `entry.p`：指向真实值的指针，状态有三种：`nil`、`expunged`、正常值。

### 3.2 `read` 和 `dirty` 的关系

`read.m` 和 `dirty` 这两张表里，**同一个 key 指向的是同一个** **`*entry`** **实例**；`entry.p` 才是真正存值的指针。

## 四、写入逻辑：理解 entry 的三种状态

`sync.Map.Store`的逻辑可以按 `entry` 的状态拆成三种情况：

### 4.1 情况一：`read` 里存在该 key，且 `p` 是正常值或 `nil`

直接在 `read` 上做一次**无锁**的 `CompareAndSwap` 修改 `entry.p` 即可。因为 `read` 和 `dirty` 共享同一个 `*entry` 指针，修改对两边同时生效。

这是 `sync.Map` 读路径"几乎无锁"的根源：只更新已有 key 时，全程不需要 `mu`。

### 4.2 情况二：`read` 里存在该 key，但 `p == expunged`

`p == expunged` 表示这个 key 之前被删过，而且当前 `dirty` 里**没有**它（`dirty` 在初始化时把这种 entry 排除了，详见下文）。

这时候必须先加锁：

1. 把 `p` 从 `expunged` 原子地恢复成 `nil`（`unexpungeLocked`）；
2. 把这个 `*entry` 写回 `dirty`；
3. 再写入新值。

### 4.3 情况三：`read` 里完全没有这个 key

这是"全新 key"。流程是：

1. 加锁。
2. 再次确认 `read` 里确实没有（防止与并发的提升操作冲突）。
3. 看看 `dirty` 里有没有（如果 `amended == true`，可能上次遗漏了）。
4. 都没有的话：
   - 如果 `dirty == nil`（`amended == false` 的情况），需要先调 `dirtyLocked()` 初始化 `dirty`：遍历 `read.m`，把 `p != expunged` 的 entry 浅拷贝过去，**同时**把 `p == nil` 的 entry 原子地置为 `expunged` 并从 `dirty` 中排除。
   - 把 `read` 替换为 `amended: true` 的新 `readOnly`。
   - 把新 key 写入 `dirty`。

到这里就能解释"删除"时的细节了：

- `Delete` 在 `p != nil && p != expunged` 时，会把 `p` 原子地置为 `nil`。此时 `dirty` 仍保留这个 entry，相当于"软删除"。
- 等下次 `dirty` 初始化时（即情况三的步骤 4），这些 `p == nil` 的 entry 会被升级成 `p == expunged`，并从 `dirty` 里彻底移除。

这就是 `expunged` 存在的意义：**它只用来标记"read 里残留、但 dirty 里已经不再需要"的那一类删除**，避免下次写时把已经清掉的 key 又"复活"回 `dirty`。

## 五、读路径：什么时候会降级到 dirty？

`Load` 的逻辑是：

1. 无锁读 `read.m`。
2. 命中：直接返回。
3. 未命中：
   - 如果 `amended == false`，说明 `dirty` 也没有，直接返回零值，**完全不需要加锁**。
   - 如果 `amended == true`，加锁、再次确认、再查 `dirty`，**同时** **`misses++`**。

注意：**不是所有"未命中"都会加锁**。只有 `amended == true`（即 `dirty` 里确实有 `read` 没有的 key）时才会走加锁路径。这也是 `sync.Map` 在"读多写少 + 写过的 key 后续很少被读"场景下能大幅降低锁竞争的另一个原因。

## 六、读和写最终怎么对齐？—— misses 提升机制

到这里你可能已经发现一个矛盾：`dirty` 里有的 key，`read` 里一开始没有，那岂不是会读一次少一次？`misses` 计数就是用来回答这个问题的。

`missLocked` 的逻辑是：

```go
func (m *Map) missLocked() {
	m.misses++
	if m.misses < len(m.dirty) {
		return
	}
	m.read.Store(&readOnly{m: m.dirty})
	m.dirty = nil
	m.misses = 0
}
```

也就是说，**当 miss 的次数累计到不小于** **`len(m.dirty)`** **时**（在常见的执行轨迹中，往往刚好命中 `misses == len(dirty)` 这一次比较，所以源码注释里也用 "cost of copying the dirty map" 来描述这个阈值），就会触发一次"提升"：

1. 把 `dirty` 整体替换为新的 `read`。
2. `dirty` 置 `nil`。
3. `misses` 清零。
4. 旧的 `read` 整体被替换掉，里面那些 `p == expunged` 的 key 随旧 `read` 一起被 GC 回收。

提升之后，`Map` 又回到"只由 `read` 承载全量有效数据"的状态——和刚初始化时一样。下一轮写新 key 时再按 §4.3 的流程重新生成 `dirty`，开启下一轮读写分离的循环。

## 七、什么时候该用 sync.Map？

`sync.Map` **不是** **`map + Mutex`** **的通用替代品**。源码注释里写得也很直白：它针对的是两种典型场景：

1. **key 写一次、读多次**（典型的"只追加型缓存"）；
2. **多个 goroutine 读 / 写 / 覆盖的 key 集合互不相交**。

如果你只是想要一个并发安全的 map，绝大多数时候 `map + sync.Mutex`（或 `sync.RWMutex`）反而更合适：类型安全、逻辑清晰、性能也不差。只有当你的访问模式**显著匹配**上述两种场景时，才考虑用 `sync.Map`。

## 八、小结

- 原生 `map` 不支持并发写，并发写会触发 `fatal error: concurrent map writes`，无法 `recover`。
- 传统方案是 `map + sync.Mutex` / `sync.RWMutex`，简单可靠，但所有读和写都要抢锁。
- `sync.Map` 用 `read` + `dirty` 双结构实现读写分离：读路径几乎无锁，写路径才加锁。
- `entry.p` 的 `nil` / `expunged` / 正常值 三态，配合 `misses` 计数和提升机制，保证了 `read` 和 `dirty` 最终能对齐。
- `sync.Map` 不是通用替代，用之前先确认你的访问模式匹配它的优化目标。

