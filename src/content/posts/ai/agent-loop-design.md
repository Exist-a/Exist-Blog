---
title: Agent 回路:Plan-and-Execute、ReAct、Reflexion 
date: 2026-09-23
excerpt: 同样一个任务,挑错回路,token 能差好几倍;反复犯同样错,可能不是 prompt 写得不够好,是回路设计就漏了一层。
category: ai
tags: [agent]
---

## 一、为什么回路需要仔细挑选

挑错回路的代价不是 prompt 调几次就能补回来的。在具体讲之前,先看一眼几个粗略的数字感受一下:

- 同一个 WebVoyager 类任务,**ReAct** 大约是 **Plan-and-Execute** 的 3-8 倍 token 消耗,具体倍数因模型和任务而异
- 在 **ReAct** 基础上叠一层 **Reflexion**,token 再往上加 1.5-2 倍
- 反复犯同样错的 agent,大概率不是 prompt 没写好,而是**回路本身就没设计成"能从失败里学到东西"的形态**

这三个回路在 agent 内部是控制流的差别,跟选什么模型、给什么 prompt 不是同一层级的问题。把它当成 prompt 工程去改,改十次都未必补得回来。

<br />

OK,数字感受完了,**那这几种回路到底长什么样?**

## 二、Plan-and-Execute:计划一次性出,然后按步走

**Plan-and-Execute** 是最像工程师写代码思路的一种回路:先写一份完整计划,然后一条一条执行,出问题再回来修计划。

### 2.1 工作模型

典型流程是这样的:

1. **Plan 阶段**:Planner 一次性产出完整计划(通常是 5-10 步的有序列表)
2. **Execute 阶段**:每一步交给一个 Executor 去执行,Executor 通常只看**当前子任务 + 完整计划**这两份上下文
3. **Replan 触发**:某一步验证不通过,整个计划回到 Planner 重新规划
4. **Verify 阶段**:最后整体验收一次,过了就停,没过再来

关键在于**计划是先出再跑**,不是边跑边想。

### 2.2 优势

- **可审计**:trace 里完整挂着那份原始计划,review 时一眼便知 agent 要干什么
- **长任务稳定**:每步 Executor 只关注自己这一步的子上下文,不会越滚越长
- **trace 友好**:5 步计划对应 5 步结果,对比清楚;比起 ReAct 那种几十个 micro Thought,事后复盘难度低一档

### 2.3 计划漂移

漂移通常发生在**第二步或第三步**之后,原因不复杂:

- 每步 Executor 看到的子上下文里,**强约束只有"我在第几步"**,没有"整份计划的当前进度状态机"
- 一旦某步的 Observation 跟计划假设不一致,Executor 默认是"尽力完成本步",不是"回去更新计划"
- 经过两三步累积,计划和实际已经脱钩,但系统没察觉,继续按旧计划往下推

这就是典型的"看起来还在按计划走,其实跑偏了"。

### 2.4 工程解决方案

- 把当前**完整计划**显式塞进每一步的 prompt 头部,不要只塞子任务
- 设置 replan trigger(连续两步验证失败 / 子任务结果与计划假设不一致)
- 计划落库,事后复盘才有材料
- 给每一步加**独立验证**(测试、构建、类型检查,而不是 LLM 自评)

## 三、ReAct:Thought → Action → Observation 短循环

**ReAct** 是另一种思路,不写完整计划,而是**每一步重新想**。

### 3.1 工作模型

它的循环特别短,典型三段式:

- **Thought**:这一步要不要查数据库?要不要先算一下?
- **Action**:真的去调用 tool / 写文件
- **Observation**:把 tool 的返回内容读回来

下一步的 Thought 基于上一步的 Observation,如此往复,直到 Thought 决定"任务完成了"为止。

### 3.2 优势

- **几跳任务(2-5 步)的最优解**:反应灵敏,不需要规划开销
- **对环境反馈敏感**:每一步都基于最新 Observation,环境一变化立刻调
- **实现简单**:LangChain、LlamaIndex 都有现成的 ReAct agent,接几个 tool 就能跑

### 3.3 token 失控

ReAct 的 Thought 链在长任务里会越长越长,而且**自身不做压缩**:

- 每一步的 Thought 都不删前面,全部塞在 context 里
- Observation 也是历史堆叠,从不多次折叠
- 跑到 20-30 步,context window 直接报警,后面步骤的相关性急剧下降(就是经典的 **Lost in the Middle**)

**这条不是 prompt 能修的**——prompt 写得再短,Thought 链每步都会重新读历史,token 注定失控。

### 3.4 工程解决方案

- **Thought 截断**:只把最近 N 轮(典型 3-5)的 Thought/Observation 塞回 context,旧的转成摘要
- **Observation 折叠**:把多条 Observation 用小模型压成一段事实陈述
- **长任务硬切换**:跑超过 N 步还没完,**手动切回 Plan-and-Execute 模式**,从 trace 里重建一份计划继续
- **每步做独立验证**:不通过就别继续 Thought 链

## 四、Reflexion:在 ReAct 之外加一层 reflect 节点

**Reflexion** 不是替代 ReAct,而是在原有回路上**外挂一层自我反思**。

### 4.1 工作模型

它的核心机制是:**跑完一段,回头看一眼哪里错了,把反思写进"经验"里**。大致是这么个工作流:

```text
[主回路:ReAct 或 Plan-and-Execute]
       ↓
[N 步触发 / 失败触发]
       ↓
[Reflector 节点:用 LLM 总结"哪里错了/哪里好"]
       ↓
[把反思结果写进可复用 memory]
       ↓
[下一轮主回路把这些经验塞回 context]
```

关键差异是这个 **Reflector 节点**——它读的是**整段执行 trace**,而不是当前步的输出。

### 4.2 优势

- **能从失败中累积**:同一类错误,第二次遇到时主回路已经能看到"上次错在哪"
- **不依赖人改 prompt**:经验由 Reflector 自动提取,不需要人手工加规则
- **可叠加**:挂在 ReAct 后、挂在 Plan-and-Execute 后都行

### 4.3 反思节点放哪最划算

这个节点放在哪儿,代价完全不同,基本就三种放法:

| 放法 | 代价 | 适用场景 |
|---|---|---|
| **每步 reflect** | token 爆炸,没人这么干 | — |
| **每阶段 reflect** | 中等,可控 | 多阶段任务(写代码 + 跑测试 + 修复) |
| **失败时 reflect** | 最省,只对错误路径生效 | 想省钱又想让 agent 从错中学 |

经验值:**绝大多数场景默认"失败时 reflect"**,只有任务阶段足够清晰(每阶段有独立验证门禁),才切到"每阶段 reflect"。

### 4.4 工程解决方案

- 反思结果**必须结构化**:`{error_type, lesson, rule}`,不要让模型自由发挥写散文
- 反思触发挂预算:总 token 上限里只给反思切走一小块
- memory 加去重:同一条经验已经在库里就别再写一遍

<br />

三种主流回路讲完了,**那真实工程里到底怎么挑?**

## 五、决策方式:任务 → 回路

挑回路不是看心情,而是看任务的几何形状。下面这张表是我个人在工程里最常用的对照:

| 任务类型 | 推荐回路 | 关键理由 |
|---|---|---|
| 几跳就完(2-5 步) | **ReAct** | 不需要规划,短循环最优 |
| 长链路、阶段清晰 | **Plan-and-Execute** | plan 可审计,trace 干净 |
| 反复犯同样错 | **Plan-and-Execute + 失败时 reflect** | 只在错误路径上反思,省 token |
| 多 Agent 协作 | **顶层 Plan-and-Execute + 子 agent 用 ReAct** | 顶层负责编排,子 agent 灵活执行 |
| 工具多、依赖复杂 | **Plan-and-Execute** | ReAct 在工具多时选错率高 |

这张表有个隐含假设:**回路是可以组合的**,也可以运行时切换。我们下面看几个真实项目怎么做的。

## 六、真实项目几乎都是混合回路

### 6.1 LangChain

LangChain 把 agent 分成了两套:**ReAct agent** 和 **Plan-and-Execute agent**,文档页面上早早用一张对比表讲清了代价:

- **ReAct agent** 在 tool 数量多(> 10 个)时,选错率明显上升——这是 ReAct 在工具多场景的自然缺陷
- **Plan-and-Execute agent** 在 plan 阶段用大模型,execute 阶段可以换成更小、更便宜的模型——这是 Plan-and-Execute 另一个隐藏优势

它的官方文档页:[`plan-execute-agent`](https://python.langchain.com/v0.1/docs/modules/agents/agent_types/plan_and_execute/) 直接承认"ReAct 适合 tool 少的简单任务",这是一个挺反共识的结论。

### 6.2 AutoGPT

AutoGPT 是**最早期踩这个坑**的项目代表。它的早期版本跑 ReAct + Reflexion 雏形,出现过两个经典症状:

- Thought 链无限增长,context window 一次跑就爆
- 失败反复出现,prompt 改了无数次也压不下去

后期版本改了两件事:

- **每 N 步落盘 + 重新读盘**:本质上是手动把一个长 ReAct 切成"短 ReAct 段 + 重启"——已经在做回路切换了
- **加入目标驱动的外层循环**:不再是一次性 ReAct,而是触发目标驱动的 Loop(基本就是仓库另一篇 [Loop Engineering](file:///d:/exist-blog/src/content/posts/ai/what-is-loop-engineering.md) 里说的 Loop 层)

这两个改动其实就是把回路从**单层 ReAct 强行升级成混合回路**。

### 6.3 Claude Code 与 DeepCode

这两个产品形态比 LangChain 更现实,因为它们是**真在用的 agent**,不是 demo:

- **Claude Code**:顶层用 Plan-and-Execute(读代码前先规划读哪些文件),每个子任务交给 tool 调用层用 ReAct 风格执行
- **DeepCode**:**顶级 Plan-and-Execute + 每步验证 + 失败时回写 trace**,是 [Loop Engineering 那篇](file:///d:/exist-blog/src/content/posts/ai/what-is-loop-engineering.md)里"Repair"机制的具体实现

它们的共同点是:**都是混合回路**。所谓"agent 项目用什么回路"这个问题,在工程语境下其实没什么意义——真实产品几乎都是顶层规划 + 短循环执行 + 反思兜底的组合。

### 6.4 MetaGPT、ChatDev 这类多 Agent 框架

这种框架顶层是 Plan-and-Execute,但 Planner 本身被拆成多个角色(产品经理 / 架构师 / 工程师),各自管一段:

- 顶层 plan 由多个 Planner 协作产出
- 每段 plan 交给对应 Executor 执行
- Execution 之间靠 SOP(标准操作流程)衔接

这类项目的回路相比上面几个**更死板、更可预测**,适合**领域流程强、需要多人协作模拟**的场景,灵活性牺牲大。

<br />

讲到这里你可能有个印象:**真实项目里几乎没有纯粹的"ReAct 项目"或"Plan-and-Execute 项目"**——选回路这事,选对了没人记得,选错了会一直烧钱。

## 小结

> 一句话概括:**回路选型不是 prompt 工程,是控制流工程——选错回路的代价按 token 算、按小时算,按 prompt 改十次都补不回来。**

- **Plan-and-Execute** 适合长链路任务,核心优势是 plan 可审计、trace 干净,代价是控制流复杂、容易发生计划漂移
- **ReAct** 适合几跳任务,核心优势是灵活、对环境反馈敏感,代价是长任务里 context 失控,prompt 改不动
- **Reflexion** 是外挂层,只在价值足够高时加,频率和触发条件必须挂预算,默认"失败时 reflect"
- **决策入口很朴素**:几跳就完走 ReAct;长链且阶段清晰走 Plan-and-Execute;反复犯同样错就加反射
- **真实项目几乎都是混合回路**,顶层规划 + 短循环执行 + 失败反思是基本盘
- **trace 必须落库**——这是事后复盘"回路是不是选错了"的唯一材料

---

## 参考资料

- ReAct 原论文:[ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- Reflexion 原论文:[Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)
- LangChain 官方文档:[`Plan-and-Execute` agent](https://python.langchain.com/v0.1/docs/modules/agents/agent_types/plan_and_execute/)、[`ReAct` agent](https://python.langchain.com/v0.1/docs/modules/agents/agent_types/react/)
- 框架级实现:[HKUDS/DeepCode](https://github.com/HKUDS/DeepCode)
- 仓库上一篇 AI 工程文章:[Loop Engineering 完整解读](file:///D:/exist-blog/src/content/posts/ai/what-is-loop-engineering.md)
