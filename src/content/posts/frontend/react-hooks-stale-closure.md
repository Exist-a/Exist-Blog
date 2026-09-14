---
title: React Hooks 闭包陷阱：为什么拿到的总是旧状态？
date: 2026-09-07
excerpt: React 每次渲染都会生成一份新的状态快照，理解渲染流程和闭包的关系，才能真正解决 Hooks 中的旧状态问题。
category: frontend
tags: [react]
---

# React Hooks 闭包陷阱：为什么拿到的总是旧状态？

我们在写 React Hooks 时，经常会遇到一个看起来很奇怪的问题：`count` 明明已经更新了，定时器或者 `useEffect` 里拿到的却还是旧值。

有些同学会把原因归结为 React 的状态更新有延迟，或者觉得是不是闭包把变量缓存住了。其实这不是 React 的 bug，而是 **JavaScript 闭包** 和 **React 渲染快照** 共同作用后的预期行为。

这篇我们围绕一个问题展开：**一次状态更新之后，React 到底做了什么，旧状态又为什么会留在回调里？**

## 一、先理解 React 的一次渲染

### 1.1 组件函数负责计算界面

函数组件可以先看成一个根据输入计算界面的函数：

```jsx
function Counter() {
  const [count, setCount] = useState(0)

  return <button>{count}</button>
}
```

第一次执行 `Counter` 时，`count` 是 `0`，React 得到一棵描述界面的虚拟 DOM 树。点击按钮或其他地方调用 `setCount` 后，React 不会直接修改这次函数执行里的 `count`，而是安排一次新的渲染。

新的渲染会再次执行 `Counter`。这一次，`useState` 返回的 `count` 变成了 `1`，React 再根据新的返回结果计算界面。

所以，组件函数不是只执行一次，而是会随着状态更新反复执行。每次执行都会产生一组新的局部变量和函数。

接下来我们针对以上例子讨论一下React的Render-Commit两阶段更新

### 1.2 render 阶段构建 WIP Fiber 树

调用 `setCount` 之后，React 首先进入调度流程。这里的 render 不是浏览器绘制页面，而是 React 在内存中计算下一份界面结果。

React 会维护两棵 Fiber 树：

- **current Fiber 树**：最近一次 commit 后已经生效的树。
- **work-in-progress Fiber 树**：基于 current 树创建或复用、正在计算中的树，简称 **WIP 树**。

Fiber 节点记录了组件、宿主节点、父子关系、兄弟关系以及待提交的更新等信息。render 阶段会从根节点开始遍历 WIP 树，在遇到函数组件时重新执行组件函数：

1. React 从更新队列中取出 `setCount` 产生的更新。
2. 以 current Fiber 树为基础，创建或复用对应的 WIP Fiber 节点。
3. 重新执行 `Counter`，得到新的 `count` 和新的 JSX 结果。
4. 协调新的子节点，并在 WIP 节点上标记需要插入、更新或删除的内容。
5. 继续遍历其他 Fiber 节点，直到 WIP 树计算完成。

render 阶段的重点是 **计算并准备一棵候选 Fiber 树**，还没有把结果写入真实 DOM。由于这只是内存中的计算，Concurrent React 可以在这个阶段暂停、恢复，甚至丢弃当前 WIP 树后重新计算。因此，render 阶段不应该执行请求、修改 DOM 这类副作用。

### 1.3 commit 阶段提交 WIP 树

当 WIP Fiber 树计算完成后，React 才进入 commit 阶段。这个阶段通常不能像 render 阶段那样随意中断，因为它要把已经确认的结果一次性提交出去。

commit 阶段主要做三件事：

1. 根据 WIP Fiber 节点上的标记，修改真实 DOM。
2. 执行需要同步处理的 layout effect。
3. 将 WIP 树切换为新的 current 树，并在之后执行 `useEffect` 这类 passive effect。

因此，一次状态更新可以串成下面这条链路：

> `setState` 触发更新 → 基于 current 树准备 WIP Fiber 树 → render 阶段重新执行组件并标记变化 → commit 阶段修改真实 DOM → WIP 树成为新的 current 树 → 执行 passive effect

这里要特别区分两件事：**Fiber 树负责组织和提交渲染工作，闭包负责保留某次组件执行时的变量**。闭包并不是把 Fiber 节点保存了下来，而是在 render 阶段执行函数组件时，形成了属于这次执行的 JavaScript 词法环境。

关键点在于，**重新执行组件函数会产生新的快照，而不是修改旧快照**。

### 1.4 每次渲染都是一份独立快照

假设组件连续经历三次渲染：

| 渲染 | 本次渲染中的 `count` | 本次渲染创建的回调 |
| --- | ---: | --- |
| 第一次 | 0 | 捕获 0 的回调 |
| 第二次 | 1 | 捕获 1 的回调 |
| 第三次 | 2 | 捕获 2 的回调 |

第二次渲染不会把第一次渲染里的 `count` 原地改成 `1`。第一次渲染创建的函数，仍然属于第一次渲染；只有新一轮渲染创建的函数才会捕获新值。

这就是 React 中 **state 是快照** 的含义。

## 二、闭包为什么会拿到旧状态

### 2.1 闭包保留创建时的作用域

JavaScript 函数会记住自己创建时所在的词法作用域：

```js
function createLogger(value) {
  return function log() {
    console.log(value)
  }
}

const log = createLogger(0)
log() // 0
```


### 2.2 异步回调把快照差异暴露出来

下面是一个完整例子。点击按钮时，组件会安排一个一秒后执行的回调：

```jsx
function Counter() {
  const [count, setCount] = useState(0)

  function handleClick() {
    setTimeout(() => {
      console.log(`一秒后读取到的 count：${count}`)
    }, 1000)

    setCount(count + 1)
  }

  return <button onClick={handleClick}>{count}</button>
}
```

假设点击时页面显示 `0`。这次点击使用的是第一次渲染创建的 `handleClick`，里面的定时器回调也捕获了 `0`。`setCount` 随后触发第二次渲染，页面显示 `1`，但已经进入定时器的旧回调不会被替换，所以一秒后仍然打印 `0`。

执行顺序可以这样看：

1. 第一次渲染创建 `count = 0` 和 `handleClick`。
2. 点击 `handleClick`，定时器回调捕获 `0`。
3. `setCount(count + 1)` 触发新的渲染。
4. 第二次渲染创建 `count = 1` 和一组新的函数。
5. 一秒后，第一步创建的定时器回调执行，读取的仍是第一次渲染的 `0`。

因此，旧状态不是从 React 内部被取出来的，而是一直保存在旧回调的闭包里。

## 三、`useEffect` 如何决定使用哪份快照

`useEffect` 的回调同样属于某次渲染。依赖数组决定 React 什么时候重新创建这份回调。

```jsx
function Counter({ count }) {
  useEffect(() => {
    const timer = setInterval(() => {
      console.log(count)
    }, 1000)

    return () => clearInterval(timer)
  }, [count])

  return <p>{count}</p>
}
```

当 `count` 变化时，React 会先执行上一次 effect 返回的清理函数，再执行新的 effect。旧定时器被清除，新定时器捕获新的 `count`。

如果把依赖数组写成 `[]`，effect 只会在挂载后执行一次，定时器也只会使用第一次渲染的 `count`。这并不代表空数组有问题，而是说明我们明确选择了 **只创建一次、只捕获初始快照** 的行为。

如果不写依赖数组，effect 会在每次渲染提交后执行。此时它会不断创建新的副作用，因此必须确认清理逻辑完整，不能把依赖数组当成随手开关。

判断依赖数组时，核心不是记住某种写法，而是问自己：**这个 effect 需要哪一次渲染中的值？值变化时，旧副作用是否需要被清理并重新创建？**

## 四、函数式更新解决连续更新问题

闭包问题还有一个常见表现：在同一次回调里连续更新同一个 state。

```jsx
function Counter() {
  const [count, setCount] = useState(0)

  function handleClick() {
    setCount(count + 1)
    setCount(count + 1)
  }

  return <button onClick={handleClick}>{count}</button>
}
```

当这次回调属于 `count = 0` 的渲染时，两次 `count + 1` 都会算出 `1`。React 可以批量处理这两个更新，但批处理不会改变回调里的旧快照，所以最后通常只增加 `1`。

这时应该使用函数式更新：

```jsx
function handleClick() {
  setCount(previousCount => previousCount + 1)
  setCount(previousCount => previousCount + 1)
}
```

函数式更新不会从闭包中读取当前的 `count`，而是告诉 React：请基于这个 state 的上一次结果继续计算。两个更新因此会依次得到 `1` 和 `2`。

这里要区分两件事：函数式更新解决的是 **同一个 state 的连续计算**，并不能自动让回调中的其他 props 或 state 变成最新值。

## 五、需要最新值时再使用 `useRef`

有些长期存在的回调确实需要读取执行时的最新值，但我们又不想因为每次变化都重新创建定时器或订阅。这时可以用 ref 保存最新值：

```jsx
function Counter({ count }) {
  const latestCount = useRef(count)

  useEffect(() => {
    latestCount.current = count
  }, [count])

  useEffect(() => {
    const timer = setInterval(() => {
      console.log(latestCount.current)
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  return <p>{count}</p>
}
```

这里的两个 effect 分工不同：第一个 effect 随 `count` 更新 ref，第二个 effect 只创建一次定时器。定时器虽然还是第一次渲染创建的，但它读取的是可变的 `latestCount.current`，所以能拿到后续同步进去的值。

`useRef` 的特点是 **修改 `current` 不会触发重新渲染**。因此，凡是变化后需要更新页面的值，仍然应该放进 `useState`；ref 更适合保存定时器 id、DOM 节点、连接对象，或提供给长期回调读取的最新值。

## 六、把整条思路连起来

现在回头看所谓的 Hooks 闭包陷阱，其实只有一条主线：

1. React 状态更新不会修改当前函数执行中的变量。
2. 状态更新会触发新的 render，组件函数再次执行并产生新快照。
3. 每个回调都闭包捕获自己创建时的那份快照。
4. 异步回调如果继续使用旧函数，就会读到旧状态。
5. 需要重新建立副作用时，把变化的值写进 effect 依赖数组。
6. 需要连续计算同一个 state 时，使用函数式更新。
7. 需要长期回调读取最新值、但不触发渲染时，使用 `useRef`。

所以，遇到旧状态时不要先问 React 为什么没有替我们更新变量，而要先问：**这个回调属于哪一次渲染，它应该读取创建时的值，还是执行时的最新值？**

## 小结

- **渲染会产生新快照**：React 通过重新执行组件函数得到新的 state、props 和回调，而不是修改旧快照。
- **闭包会保留旧快照**：异步回调属于创建它的那次渲染，因此可能继续读取旧状态。
- **依赖数组控制 effect 的重建**：依赖变化时先清理旧副作用，再创建捕获新值的回调。
- **函数式更新处理连续 state 更新**：它基于同一个 state 的上一次结果计算，不负责修复所有旧闭包。
- **`useRef` 提供可变的最新值**：它适合长期回调读取，但 `current` 变化不会触发页面重新渲染。
