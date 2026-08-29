---
title: Python 基本数据结构的底层原理
date: 2026-08-29
excerpt: 从 list 的动态数组与 1.125× 扩容，到 dict 的紧凑哈希表与插入序，再到 set / str / deque 的实现差异，看懂 CPython 容器在内存里的真容。
category: backend
tags: [python]
---

写 Python 的时候我们都知道`list`要追加元素用`append`、`dict`查询是 O(1)、`for x in s`查一个集合很快。**这些经验性的结论是怎么来的？底层到底长什么样？** 这一篇我们钻进 CPython 源码,把几大基本数据结构扒开来聊聊。

别急,内容不少,但每个章节都不长,慢慢看。

> 一句话概括: **CPython 不是一个 C++ 容器类的封装,而是一组用 C 手写、深度互相依赖的结构 —— `set` 借了 `dict` 的骨架,`tuple` 是 `list` 的不可变兄弟,`str` 用紧凑编码省内存,`deque` 用链表 of 块数组处理两端。**

## 引言:先看一眼 CPython 的数据结构全貌

虽然这一篇我们会逐个讲`list`/`tuple`/`dict`/`set`/`str`/`deque`六种容器,但它们的底层实现其实**互相借力,共用一套思路**。在钻进细节之前,先站在高处看一眼,后面讲每个具体结构时心里都有个共同的坐标系。

### 0.1 CPython 是 C 写的,不是 C++

`CPython`这个名字默认指 Python 官网下载的解释器。它本身是用 C 实现的(而不是 C++ 的 STL、也不是 Rust 的 `Vec`),所以一切内置容器的**对象**在源码层面都是`PyObject`、`PyTypeObject`等结构体加上函数指针表。**好处是解释器能精细控制每一块内存**,坏处是很多设计权衡都带着浓厚的 C 历史包袱,不像现代语言那么抽象、那么系统级。

我们后面要看的`list`、`dict`、`set`、`tuple`、`str`、`deque`,要么在`Objects/`目录下,要么在`Modules/_collectionsmodule.c`里,都是手写的 C 结构,每种都对应一个独立的`PyXxxObject`类型。

### 0.2 三类底层结构 + 一种特例

把六种容器按底层结构分类,**核心其实只有三类**:

| 类别 | 底层结构 | 对应容器 | 关键复杂度优势 |
|---|---|---|---|
| 连续内存 | 指针数组 / 紧凑编码 | `list`、`tuple`、`str` | 下标 O(1)、顺序缓存友好 |
| 哈希表 | 稀疏桶 + 紧密条目 | `dict`、`set` | 哈希定位期望 O(1) |
| 链表 of 块 | 固定长度块 + 指针链 | `collections.deque` | 两端插入/删除真 O(1) |

而`tuple`是`list`上的**不可变 + 内存更紧凑**变体、`set`是**只存 key 的`dict`**,这些**派生关系**正是一句话概括里讲的**互相借力**的具体体现。

### 0.3 三个贯穿全篇的设计套路

读完六节之后你会发现,CPython 数据结构里反复出现三个套路:

- **就地复用余量** —— `list`扩容按 1.125× 多挂一点,`dict`装载因子到 2/3 就 rehash 翻倍,`deque`分块链表每块 64 槽,核心都是**每次多备一点,把单次大开销摊薄到多次小操作**。
- **就地缓存元素引用** —— `list`、`tuple`、`dict`所有容器里,**存的都是指向真实对象的`PyObject*`**(统一引用计数),而不是把数据本体嵌进来。代价是多一跳指针,好处是一份数据可以被多个容器共享,GC 时也方便回收。
- **不变性换来特殊能力** —— `tuple`可以哈希,所以能做`dict` key;`str`在 PEP 393 之后选最紧凑编码,所以能省内存;`frozenset`不可变,可以做另一个`dict`的 key。**凡是要求稳定哈希的场合,都建立在不可变上**。

记住这三点,后面每个章节其实是把其中一个套路应用到具体容器上。

## 一、`list`：连续指针数组 + 适度扩容

### 1.1 内存里长什么样

CPython 的`list`实际上是一块**连续的指针数组**。你可以把它理解成 C 里的`PyObject* arr[N]`,元素地址跟数组下标是一一对应的线性关系。`PyListObject`自己只保留头部信息和`ob_item`这个指针,`ob_item`指向一段 malloc 出来的`PyObject*`数组,**元素都是引用**而不是对象本体(也就是说,`lst`里存的不是整数本身,而是指向那个整数对象的**引用**)。

这有两个推论:

- `lst[i]`计算地址只需要`base + i * sizeof(PyObject*)` —— **基地址 + 偏移量**这种定位方式跟数组一模一样,所以**下标访问是 O(1)**。
- `len(lst)`就是读头部里的`ob_size`(一个整数),**这跟从 1 数到 N 完全不同,是一步到位的字段读取**,同样 O(1)。

```python
# 表面上 lst 里放着整数,实际 lst 里放着 PyObject* 指针
a = [1, 2, 3]
# a[0]、a[1]、a[2] 是指向小整数对象的指针,而小整数在解释器里是单例的
print([id(x) for x in a])
# 所以 lst 的存储长度只跟**有几个槽**有关,跟元素类型无关
```

### 1.2 扩容策略:1.125× 增长

`list`不是固定大小的数组,长度增加的时候就要**动态扩容** —— 也就是说,**剩余容量装不下新元素时,需要重新申请一块更大的连续内存,把旧数据整体迁移过去**。CPython 里的扩容公式藏在`Objects/listobject.c`的`list_resize`里:

```c
new_allocated = ((size_t)newsize + (newsize >> 3) + 6) & ~(size_t)3;
```

**新容量 ≈ 旧容量 × 1.125**,然后向上对齐到 4 的倍数。给个增长序列感受一下:

> 0, 4, 8, 16, 24, 32, 40, 52, 64, 76, ...

为什么不是 +1 而是 1.125×? **为了摊销**。这里的**摊销**是说:虽然单次扩容需要迁移一整段元素,成本较高,但每次多预留的容量会摊薄后续多次`append`的开销,平均到每一次上仍然是一个常数。数学上就是:按 1.125× 增长,连续 n 次`append`所付出的元素拷贝总开销是 O(n),均摊到每次就是 O(1)。如果按 +1 增长,n 次 append 累计就要 O(n²) 次拷贝 —— 慢得多。

所以教程里说的 `append` 是 O(1) 其实只是**均摊结论,不是每次都是常数** —— 其中偶发的几次 `append`(碰到扩容点)会很慢,要 realloc + memcpy 整段指针,这就是你写 benchmark 偶尔看到一次诡异延迟的**真凶**。

### 1.3 中段操作为什么是 O(n)

```python
b = list(range(10**5))
b.insert(0, -1)   # O(n):要把 10w 个指针整体 memmove 一个位置
b.pop(0)          # O(n):同理
```

`insert(0, x)`和`pop(0)`要把下标之后的所有指针**整段往后/往前迁移一个槽**(`memmove`是 C 标准库提供的**整段内存迁移**函数,这里等于把所有指针同步向后移动一个槽位,不需要逐个重新定位)。100 万条数据的 list,在头部挪一个元素就是 100 万次指针拷贝 —— 这是 list 在**头插场景下性能被 deque 全面领先**的根本原因,后面讲`deque`时回头看。

顺便提一句: `list_resize`其实是**不只管扩容,也管缩容**。当新长度落在当前容量的 `[1/2, 1]` 区间里,它不会真的 realloc,只是改`ob_size`,所以大部分`pop()`在容量减半之前都是真 O(1),过半才触发缩容。

## 二、`tuple`:`list` 的不可变兄弟

理解了`list`之后,`tuple`就是一句话:**结构跟 list 很像,但长度固定,内存更紧凑**。

### 2.1 内存模型差别

`PyTupleObject`在结构体尾部**直接**放`PyObject *ob_item[1];`(变长数组内联),既没有`allocated`这个多余字段,`ob_item`也不指向另一块单独的指针数组。代价是不可变 —— 长度初始化后就再不动。

```python
import sys

a = [1, 2, 3, 4, 5, 6, 7, 8]
b = (1, 2, 3, 4, 5, 6, 7, 8)

# 同等长度下,tuple 通常更省内存(少一次指针 + 没有 allocated 字段)
print("list :", sys.getsizeof(a))   # 多一点
print("tuple:", sys.getsizeof(b))   # 少一点
```

### 2.2 为什么 `tuple` 能做 `dict` key,`list` 不能

**`tuple` 不可变,意味着它可以算出一个稳定不变的哈希值(所谓**哈希值**,你可以理解成一段内容物经过哈希函数算出来的**指纹字符串**,在`dict`内部就是用这个指纹去定位槽位的);`list` 可变,你今天往里`append`一条,明天又`pop`掉,**指纹会变**—— 谁也算不出一个过期不失效的哈希**。这是 CPython 区别对待两者的根本原因。

这个细节其实跟下一节的`dict`是一脉相承的:**任何要做 dict key 或 set 元素的值,都必须满足哈希值终生不变这个约束**(因为一旦哈希变了,你以前 hash 算出来应该去的那个槽位,可能跟现在 hash 该去的槽位已经不一样了 —— 同样的 key 会被误判为**找不到了**)。

```python
d = {(1, 2, 3): "ok"}
try:
    d[[1, 2, 3]] = "no"
except TypeError as e:
    print(e)    # unhashable type: 'list'

# tuple 也只能**全元素都可哈希**时才能哈希
try:
    d[(1, [2, 3])] = "no"
except TypeError as e:
    print(e)    # unhashable type: 'list'
```

## 三、`dict`:紧凑哈希表 + 插入序的由来

### 3.1 不只是哈希表 —— 是两张数组

> **哈希表**在初见时可能有点抽象,可以先理解成: **给一个 key,用它求一个哈希值(数字**指纹**),用这个指纹取模一下就决定它应该放在一张表的哪个槽位**。比起**一个一个从头找**,这是用**算出来的下标**直接定位。

CPython 3.6 起,`PyDictObject`里的`PyDictKeysObject`长这样:

- `dk_indices[]`: **稀疏的哈希桶数组** (你可以把它想成一张稀疏表,只记录 key 应该被定位到的下标,中间允许出现空槽),本职是给我一个 key,我能定位到它在下方的哪个条目;
- `dk_entries[]`: **紧密的条目数组**(把有编号牌的出口对应的那些条目,真实地挨着摆在一起,完全不浪费空间),按插入顺序追加,存放真正的`PyDictKeyEntry`(key + value)。

遍历`dict`就是走`dk_entries`,所以**遍历顺序天然就是插入顺序**。这就是 **3.7 之后 dict 保留插入序**在底层是怎么发生的 —— 不是事后排序,根本就是按物理顺序读的。

```python
d = {}
d["b"] = 1
d["a"] = 2
d["c"] = 3
d["b"] = 99        # 更新已有 key 的值,不改变位置
d.pop("a")
d["a"] = 4         # 重新插入时落到尾巴
list(d.items())    # [('b', 99), ('c', 3), ('a', 4)]
```

### 3.2 从 3.6 到 3.7 的故事

CPython 3.6 引入了这套**稀疏索引 + 紧密条目**的**紧凑字典(compact dict)**,主要动机是**省内存** —— 实测能小 20% 到 25%。插入序只是顺带发生的副产物,3.6 那会儿还只是**实现细节**。

到了 3.7,社区观察了 3.6 一年的稳定性之后,把这条性质**升格为语言规范**写入文档。这是一个少见的**性能优化反过来推动语言设计**的例子。

> 出处: [Python 3.7 What's New](https://docs.python.org/3/whatsnew/3.7.html#dict-and-set-comprehensions-have-been-rewritten-for-speed-bpo-26115)、[Python 3.6 What's New](https://docs.python.org/3/whatsnew/3.6.html#new-dict-implementation)。

### 3.3 装载因子 ~2/3 与扩容

**开放寻址**是哈希表解决冲突的一类办法:**当 key 算出来的槽位被占了,就按某种规则往后挪几格再放**(CPython 用的是**先线性探查几次,失败再切换到扰动式探查**的混合策略)。它的成本是要保证哈希表里有足够的**空槽**作为探查的落脚点,所以 CPython 不让哈希表真正装满。源码里有:

```c
#define USABLE_FRACTION(n) (((n) << 1)/3)   /* 约 2/3 */
```

也就是说,**可用槽位 ≈ 哈希表大小的 2/3**。当可用槽位耗尽时,字典触发一次 rehash(重新分配一张更大的哈希表,把所有 key 重新算哈希值并迁移过去)+ 翻倍扩容(把哈希表尺寸直接翻倍,确保余量充足),所有 key 重新洗牌。这一行就是 **`dict` 查找平均 O(1)、最坏 O(n)** 的来源 —— 通常情况下空槽充足,探查路径很短;万一碰上一堆冲突的 key,探查就会退化成线性扫描(为了找一个 key,得顺着槽位一个个往下走,体验近似于在 list 里搜)。

### 3.4 删除键之后槽位为什么要保留(墓碑机制)

`del d[k]`之后那个槽位并不是简单的清空,而是变成一个**墓碑(tombstone)**,即`DKIX_DUMMY`。为什么不直接清掉?

因为开放寻址靠**走到空槽就停**来判定**这个 key 不存在**。**清空等于提前结束探查路径,会让原本应该被找到的同族 key 永远找不到**。留个墓碑,探查就能**穿过去**继续走;等到下次 rehash 时,墓地会被顺手清掉。

```python
d = {f"k{i}": i for i in range(8)}
# 现在删一个
del d["k3"]
print("k3" in d)        # False —— 探查很快终止在墓碑
print("k3" in d.keys())  # 同上

# 再插同名
d["k3"] = 999
# 用的就是原来那个槽(墓碑被新 entry 替换),字典大小不会变
```

反复`pop` + 同一 key 重新插入,字典空间稳定,代价是墓碑比例暂时上升 —— 直到下次 rehash 才一并清理。

### 3.5 最坏情况与 PEP 456

历史上有过一类**哈希碰撞攻击**: 攻击者构造一组精心选择的 key,让所有 key 的哈希值都撞到同一个槽,让`dict`查找退化成 O(n²),从而把服务拖死。CPython 从 3.3 起对 str/bytes/dict 的哈希加了**启动时随机的种子**,3.4 起改成 SipHash 算法,让对手无法预判哪些输入会撞。

不过放心,**正常业务代码碰不到这种最坏情况**。你在自己代码里能遇到的最常见 dict 性能问题,基本是**装载因子到 2/3 频繁 rehash**,以及**重写 `__eq__` 却忘了重写 `__hash__` 导致对象变 unhashable**。

```python
class User:
    __slots__ = ("id",)
    def __init__(self, uid): self.id = uid
    def __eq__(self, o):
        return isinstance(o, User) and self.id == o.id
    def __hash__(self):
        return hash(self.id)   # __eq__ + __hash__ 要一起出现,不能只写一个

u = {User(1): "alice"}        # OK
```

## 四、`set`:共享了 `dict` 的骨架

### 4.1 派生关系

`Objects/setobject.c`文件头注释第一句写得很直接:

> Derived from Objects/dictobject.c.

也就是说,`set`的实现**借了 dict 的整套哈希表 + 探查算法**,只是不存 value。`PySetObject`里有:

- `table` / `mask`: 哈希表的指针与容量掩码;
- `used`: 已占用的活跃槽数;
- `fill`: 占用 + dummy 槽数(用来判断何时扩容);
- `smalltable[PySet_MINSIZE]`: **小集合内联存储** —— 当元素很少时,哈希表直接在 set 对象里,完全省一次 malloc。

```python
# 小集合几乎没有创建开销
small = {1, 2, 3}    # smalltable 直接放得下,table 仍指向内部 buffer
```

### 4.2 `x in s` 为什么比 `x in lst` 快

对于集合这种**只想知道某个东西在不在里头**的问题, **set / dict 这种哈希结构** 的做法是: **算一遍哈希值,直接定位到一个槽去看**;而 **list 这种连续数组** 没法算哈希,只能用**挨个遍历比对**的笨办法(也就是线性扫描)。这就是所谓的**哈希寻址 vs 线性扫**的区别。10 万条数据里找一个值,set 是几微秒,list 可能要好几毫秒:

```python
import timeit

n = 100_000
lst = list(range(n))
s = set(lst)

t_lst = timeit.timeit("99999 in lst", globals={"lst": lst}, number=1000)
t_set = timeit.timeit("99999 in s",   globals={"s": s},   number=1000)
print(f"list: {t_lst*1000:.2f} ms")   # ~10ms 量级
print(f"set:  {t_set*1000:.2f} ms")   # ~1ms 量级,差距一目了然
```

### 4.3 `frozenset` 是能哈希的集合

`set` 可变,所以没法算稳定哈希;**`frozenset` 不可变,可以**。要用**一组标签**作为另一 dict 的 key,必须用`frozenset`。

```python
fs = frozenset({"python", "cpp"})
catalog = {fs: "primary-stack"}    # OK, frozenset 是 hashable 的

try:
    catalog[{fs, "rust"}] = "x"    # set 不可哈希
except TypeError as e:
    print(e)                       # unhashable type: 'set'
```

## 五、`str`:PEP 393 紧凑 unicode + 驻留(intern)

### 5.1 PEP 393:四种紧凑编码

> **PEP**是 Python 增强提案(Python Enhancement Proposal)的缩写,是给 Python 本身提改动的**官方设计文档**。 PEP 393 就是 3.3 那次把`str`实现重新设计为**按内容挑编码**的提案。

Python 3.3 起,`str`内部按**最宽字符**(**最宽字符**是指这串里头字符编码范围最大的那一个)挑一种最紧凑的表示:

| 最宽字符所在范围 | 每字符字节数 | 适用场景 |
|---|---|---|
| ASCII(< 128) | 1 字节 | 绝大多数英文 / 数字 / 标识符 |
| Latin-1(< 256) | 1 字节 | 西欧部分字符 |
| BMP 但 ≥ 256 | 2 字节 | 大部分中文 |
| 非 BMP(如 emoji) | 4 字节 | 少数超出 BMP 的字符 |

所以大部分**普通英文 + 数字**的字符串,内存里每个字符只占 **1 字节**(紧凑编码下,一段`'hello'`只占 5 个字节,而不是 PEP 393 之前那种 20 字节起步的浪费),既省内存,遍历也快。PEP 393 之前的 Python 3 是 **wide build**,每个字符至少 4 字节,典型的内存浪费(一段 1 万字符的英文摘要,以前要花 40 KB,现在只占 10 KB 出头)。

> 出处: [PEP 393 – Flexible String Representation](https://peps.python.org/pep-0393/)。

### 5.2 字符串驻留:藏在 dict 哈希后的那一招

字符串驻留(string interning)的意思是:**CPython 为某段字符串只保留一份内存,任何用到同样字面量的地方都指向同一个对象**(可以理解为 CPython 内部维护了一张字符串缓存,字面量相同的对象直接复用同一份内存,避免重复分配)。

自动驻留发生在 **identifier-like** 的字符串 —— 长得像变量名、且非常短(具体上限跟 CPython 版本相关,**软化措辞: 通常是非常短的 ASCII 标识符**)的字符串字面量。模块 / 类 / 实例`__dict__`的键名都属于这种。

```python
a = "hello"
b = "hello"
print(a is b)         # True:identifier shape 自动 intern

x = "hello world"
y = "hello world"
print(x is y)         # False:带空格,文档不保证自动 intern
print(x == y)         # True:内容仍然相等

import sys
print(sys._is_interned(a))      # True(3.13+ 可观察)
print(sys._is_interned(x))      # 不一定有
```

**驻留真正有价值的地方**: dict 哈希命中候选槽位之后,要拿候选 key 跟表里已有的 key 调`__eq__`比对。**驻留过的字符串之间,内容比较可以直接退化成指针相等**,省一次遍历。这就是模块属性查找反复走`__dict__`却还是很快的小秘密。

需要确保同一身份时,用`sys.intern`显式驻留,**别拿`is`判断普通字符串相等** —— 这是 Python 面试题常踩的坑。

```python
import sys

# 把长字符串(比如配置文件里的 key / 日志里的固定 token)显式 intern
key = sys.intern("user.profile.email")
```

## 六、`collections.deque`:`list.pop(0)` 的替代品

### 6.1 结构:64 槽块的链表

`deque`不是纯链表,也不是数组,**而是链表 of 固定 64 槽数组** —— 你可以这么想象:把数据切成一段一段的小数组,每段最多放 64 个元素,这些**段**再像链条一环扣一环地连起来。每个块结构大致是:

```c
typedef struct BLOCK {
    struct BLOCK *leftlink;
    PyObject *data[BLOCKLEN];   /* BLOCKLEN == 64 */
    struct BLOCK *rightlink;
} block;
```

这种设计就是想兼得两边的好处:**链表型结构方便在头/尾插入新段(只改一段的链接),数组型结构方便在段内按下标定位**。`deque`本身只保存左右两块边界指针 + 各自索引,左/右`append`是在块内移动索引,满了再新分配一个块;**整个过程不搬已有元素**,所以两端操作是**真 O(1)**(不依赖 amortized)。

```python
from collections import deque

d = deque(maxlen=3)
for x in [1, 2, 3, 4, 5]:
    d.append(x)
print(list(d))    # [3, 4, 5]:满了自动丢头
```

### 6.2 真正的 O(1) 头删

list 和 deque 在头插 / 头删上的性能差异不是大一点半点:

```python
import timeit
from collections import deque

n = 100_000
lst = list(range(n))
dq = deque(lst)

t_lst = timeit.timeit("lst.pop(0)",     globals={"lst": lst}, number=1000)
t_dq  = timeit.timeit("dq.popleft()",   globals={"dq": dq},   number=1000)
print(f"list.pop(0):     {t_lst*1000:.2f} ms")   # 几十毫秒
print(f"deque.popleft(): {t_dq*1000:.2f} ms")    # 一两毫秒,O(1) 真不是嘴上说说
```

简单说就是: **`list.pop(0)` 是 memmove 整段;`deque.popleft()` 动一个索引**。前者需要把后续所有指针按顺序向前迁移一个槽位;后者只需要调整头索引,不动已有元素,因此操作时间是固定的常量级。

### 6.3 `maxlen` 滑动窗口

`deque(maxlen=n)`满了之后继续`append`,会自动从另一端弹出,等于**白送一个固定大小的滑动窗口**(永远只保留最近 n 条数据,新数据进来,旧数据就被挤走)。`Unix tail -n` 就是这种用法的典型场景:

```python
from collections import deque
with open("big.log", "r") as f:
    tail = deque(f, maxlen=10)
```

要注意:`deque`中段访问仍是 O(n)(要走块链表),所以**别拿它当 list 用**。

## 七、跨结构对比:4 种内存布局

| 容器 | 内存布局 | 访问特性 | 关键来源 |
|---|---|---|---|
| `list` | 连续指针数组 + 多余容量 | 下标 O(1),头删/中段挪 O(n) | `Objects/listobject.c` |
| `tuple` | 变长数组内联在结构体尾 | 不可变,比 list 省内存 | `Objects/tupleobject.c` |
| `dict` / `set` | 双数组:稀疏哈希桶 + 紧密条目 | 查找期望 O(1),最坏 O(n) | `Objects/dictobject.c`、`Objects/setobject.c` |
| `str` | 紧凑 unicode(1/2/4 字节/字符) | 下标、切片 O(1),intern 后`is` 比较为 O(1) | [PEP 393](https://peps.python.org/pep-0393/) |
| `deque` | 64 槽块的链表 | 两端 O(1),中段 O(n) | `Modules/_collectionsmodule.c` |

一行结论: **CPython 没有走一种数据结构包打天下的路线,而是按访问模式挑最贴合的底层**。

## 小结

- **`list` 是连续指针数组**,扩容按 1.125× 比例均摊,所以`append` 平均 O(1);**中段插入 / 删除是 O(n)** 因为要 memmove 一整段。
- **`tuple` 是不可变的`list`**,内联指针数组,内存更紧凑;**正因为不可变,它能算出稳定哈希,从而能充当 dict key**。
- **`dict` 不是单数组,而是稀疏哈希桶 + 紧密条目**双数组,3.6 为了省内存、3.7 顺带把插入序升格为语言规范;**装载因子 ~2/3** 触发 rehash,**删 key 留墓碑**保证探查路径不被打断,**SipHash** 防哈希碰撞攻击。
- **`set` 借用 `dict` 的骨架**,只存 key 不存 value;**小集合内联不 malloc**,`x in s` 走哈希;**`frozenset` 不可变所以可哈希**。
- **`str` 由 PEP 393 选了最紧凑编码**,绝大多数英文串每个字符 1 字节;**intered 字符串**在做 dict 哈希后的等值比对时可以走指针比较,白送一个加速。
- **`deque` 是链表 of 64 槽块**,两端`append` / `pop` 是**真 O(1)**(不依赖 amortized);用它做头插头删场景,跟`list.pop(0)` 比起来是数量级的差距。

## 参考资料

- [Python 官方 FAQ – Design and History](https://docs.python.org/3/faq/design.html) — list 是变长数组这一基本事实
- [Python wiki – TimeComplexity](https://wiki.python.org/moin/TimeComplexity) — 各容器 Big-O 的官方汇总
- [Python 3.6 What's New](https://docs.python.org/3/whatsnew/3.6.html) — 紧凑字典首次登场
- [Python 3.7 What's New](https://docs.python.org/3/whatsnew/3.7.html) — 插入序升格为语言规范
- [PEP 393 – Flexible String Representation](https://peps.python.org/pep-0393/) — str 的四种紧凑宽度
- [PEP 456 – Secure and interchangeable hash algorithm](https://peps.python.org/pep-0456/) — SipHash 与哈希随机化
- [CPython 源码 `Objects/listobject.c`](https://github.com/python/cpython/blob/main/Objects/listobject.c) — 1.125× 扩容公式
- [CPython 源码 `Objects/dictobject.c`](https://github.com/python/cpython/blob/main/Objects/dictobject.c) — 双数组与装载因子
- [CPython 源码 `Objects/setobject.c`](https://github.com/python/cpython/blob/main/Objects/setobject.c) — Derived from dictobject.c
- [CPython 源码 `Modules/_collectionsmodule.c`](https://github.com/python/cpython/blob/main/Modules/_collectionsmodule.c) — deque 的块结构
