---
sidebar_position: 5
---

# Starvation

> 注：本文使用的 `react` 版本为 `v18.2.0`，饥饿状态有关源码在 `/packages/react-reconciler/src/ReactLane.js -> markStarvedLanesAsExpired`

饥饿问题是可以说是属于高优先级更新任务打断低优先级更新任务的延伸，简单来说就是如果低优先级更新任务不能被高优先级更新任务一直打断，低优先级更新任务会有一个过期时间，如果当前时间超过了过期时间则会以一个同步的优先级执行本次的更新任务

下面我们来看一个例子

```css
/* App.css */
.container {
  overflow-y: auto;
  display: flex;
  border: 1px solid #000000;
  width: 1200px;
  height: 400px;
}

.handle-area,
.result-outer-area {
  overflow-y: auto;
  flex: 1 0 600px;
  word-break: break-all;
}

.result-inner-area {
  width: 100%;
  height: 100%;
}
```

```jsx
// App.jsx
import { useState, useEffect, useRef, useMemo, useTransition } from 'react';
import './App.css';

function Child1() {
  const [count1, setCount1] = useState(0);
  const [_, startTransition] = useTransition();

  return (
    <div className="handle-area">
      <button
        onClick={() => {
          startTransition(() => {
            setCount1((preCount1) => preCount1 + 1);
          });
        }}
      >
        低优先级
      </button>
      <br />
      {new Array(50000).fill(0).map((_, index) => {
        return <span key={index}>{count1}</span>;
      })}
    </div>
  );
}

function Child2() {
  const [count2, setCount2] = useState(0);

  return (
    <div className="result-outer-area">
      <div
        className="result-inner-area"
        onMouseMove={() => setCount2((preCount2) => preCount2 + 1)}
      >
        count2: {count2}
      </div>
    </div>
  );
}

function App() {
  return (
    <div className="container">
      <Child1 />
      <hr />
      <Child2 />
    </div>
  );
}

export default App;
```

操作步骤为：点击低优先级按钮，然后鼠标迅速在右边的区域进行滑动

效果图如下：

![starvation](./images/starvation.gif)

从上图可以很清楚地看到鼠标在右边滑动的期间 `count2` 有一个很明显的停滞期，原因就是当前时间超过低优先级更新任务的过期时间了，低优先级更新任务开始以一个同步的优先级执行，这里也有一个值得思索的地方，为什么一开始 `count2` 的增加速度比较慢呢，卖个关子，后面再说，现在我们来看下饥饿状态的实现原理

标记饥饿状态的方法叫做 `markStarvedLanesAsExpired`，讲这个函数之前还要先讲一下里面几个关键函数

`pickArbitraryLaneIndex`：拿到最左边的 `lane` 在 32 位数组中的索引

```js
// Math.clz32 是一个 JavaScript 数学函数，用于返回一个数字的 32 位二进制表示中从最高位开始连续的 0 的个数。如果这个数字是负数，则返回 0。
// console.log(Math.clz32(1)); // 31
// console.log(Math.clz32(1000)); // 22
// console.log(Math.clz32(0)); // 32
// console.log(Math.clz32(-1)); // 0
function pickArbitraryLaneIndex(lanes) {
  return 31 - clz32(lanes);
}
```

`computeExpirationTime`：顾名思义就是计算过期时间，根据优先级计算一个过期时间

```js
function computeExpirationTime(lane, currentTime) {
  // 不同 lane 会有不一样的过期时间
  // 优先级越高，过期时间越早
  switch (lane) {
    case SyncHydrationLane:
    case SyncLane:
    case InputContinuousHydrationLane:
    case InputContinuousLane:
      // User interactions should expire slightly more quickly.
      //
      // NOTE: This is set to the corresponding constant as in Scheduler.js.
      // When we made it larger, a product metric in www regressed, suggesting
      // there's a user interaction that's being starved by a series of
      // synchronous updates. If that theory is correct, the proper solution is
      // to fix the starvation. However, this scenario supports the idea that
      // expiration times are an important safeguard when starvation
      // does happen.
      return currentTime + 250;
    case DefaultHydrationLane:
    case DefaultLane:
    case TransitionHydrationLane:
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
      return currentTime + 5000;
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
      // TODO: Retries should be allowed to expire if they are CPU bound for
      // too long, but when I made this change it caused a spike in browser
      // crashes. There must be some other underlying bug; not super urgent but
      // ideally should figure out why and fix it. Unfortunately we don't have
      // a repro for the crashes, only detected via production metrics.
      return NoTimestamp;
    case SelectiveHydrationLane:
    case IdleHydrationLane:
    case IdleLane:
    case OffscreenLane:
      // Anything idle priority or lower should never expire.
      // NoTimestamp 就是 -1
      return NoTimestamp;
    default:
      if (__DEV__) {
        console.error('Should have found matching lanes. This is a bug in React.');
      }
      return NoTimestamp;
  }
}
```

`markStarvedLanesAsExpired`：

```js
function markStarvedLanesAsExpired(root, currentTime) {
  // 下面 suspendedLanes 和 pingedLanes 是和 Suspense 相关的 lanes，本节暂不深究
  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;

  const pendingLanes = root.pendingLanes;
  // 一个 32 位的数组，对应每一位 lane
  //   0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0
  // [-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1]
  // root.expirationTimes 会在 commit 阶段被重置， commitRootImpl -> markRootFinished -> root.expirationTimes 重置
  const expirationTimes = root.expirationTimes;

  // Iterate through the pending lanes and check if we've reached their
  // expiration time. If so, we'll assume the update is being starved and mark
  // it as expired to force it to finish.
  // 遍历 pendingLanes 并检查是否已经到达它们的过期时间。
  // 如果是这样，我们将假设更新处于饥饿状态，并将其标记为过期以强制其完成。
  let lanes = pendingLanes & ~RetryLanes;
  while (lanes > 0) {
    // 假设 lane 为 1，则 index 为 0，则 1 << index 为 1
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    const expirationTime = expirationTimes[index];
    if (expirationTime === NoTimestamp) {
      // 这个 lane 对应的 expirationTimes 的位置还没有过期时间，这时候就要计算一个过期时间
      if ((lane & suspendedLanes) === NoLanes || (lane & pingedLanes) !== NoLanes) {
        expirationTimes[index] = computeExpirationTime(lane, currentTime);
      }
    } else if (expirationTime <= currentTime) {
      // 这个 lane 过期了
      // 把它放到 fiberRootNode 的 expiredLanes 上
      root.expiredLanes |= lane;
    }

    // 从 lanes 集合中移除这个 lane
    lanes &= ~lane;
  }
}
```

好了，讲完饥饿状态有关的方法之后，再讲一下饥饿状态在 `react` 更新流程中的作用

`markStarvedLanesAsExpired` 是在调度阶段开始的时候被调用的，这里稍微提一下其实调度的启动方法叫 `ensureRootIsScheduled`，`markStarvedLanesAsExpired` 之前也是放在 `ensureRootIsScheduled` 开头的，`react` 最近有个 [PR](https://github.com/facebook/react/pull/26512) 将更新调度的逻辑移动到了微任务中，原因如下

![move update scheduling to microtask](./images/move_update_scheduling_to_microtask.png)

简单翻译一下就是提高一些性能，方便之后的在微任务中扩展逻辑

```js
function scheduleTaskForRootDuringMicrotask(root, currentTime) {
  // Check if any lanes are being starved by other work. If so, mark them as
  // expired so we know to work on those next.
  // 检查是否有 lane 被其他工作占用。是，则将它们标记为过期，以便接下来处理它们。
  markStarvedLanesAsExpired(root, currentTime);
  // ...
}
```

好了上面标记完饥饿状态之后，我们来到再来到 `performConcurrentWorkOnRoot` 这个方法

```js
function performConcurrentWorkOnRoot(root, didTimeout) {
  // ...

  const shouldTimeSlice =
    !includesBlockingLane(root, lanes) &&
    !includesExpiredLane(root, lanes) &&
    (disableSchedulerTimeoutInWorkLoop || !didTimeout);
  let exitStatus = shouldTimeSlice
    ? renderRootConcurrent(root, lanes)
    : renderRootSync(root, lanes);

  // ...
}
```

上面的逻辑决定了是否开启时间分片，我们把目光聚焦在 `includesExpiredLane` 上

```js
function includesExpiredLane(root: FiberRoot, lanes: Lanes): boolean {
  return (lanes & root.expiredLanes) !== NoLanes;
}
```

这里就用到了 `root.expiredLanes`，如果之前的 `markStarvedLanesAsExpired` 标记饥饿状态时有 `lane` 过期，这里就会返回 `true`，此时就不会开启时间分片，而是会以同步的方式执行

拓展一下，我也们来看看 `includesBlockingLane` 方法

```js
export function includesBlockingLane(root: FiberRoot, lanes: Lanes): boolean {
  if (
    // allowConcurrentByDefault 此时还是 false，将来可能会为改变
    allowConcurrentByDefault &&
    (root.current.mode & ConcurrentUpdatesByDefaultMode) !== NoMode
  ) {
    // Concurrent updates by default always use time slicing.
    return false;
  }
  const SyncDefaultLanes =
    InputContinuousHydrationLane | InputContinuousLane | DefaultHydrationLane | DefaultLane;
  return (lanes & SyncDefaultLanes) !== NoLanes;
}
```

可以看出来，`react18` 并没有默认开启了时间分片这个特性（将来可能会改变），因为我们平时常用的在各种交互、`useEffect`、`setTimeout` 等中的 `setState` 产生的 `update lane` 都不属于 `SyncDefaultLanes` 的范畴，我们需要手动使用 `useTransition` 才会开启时间分片

最后，前面还留了一个问题，**为什么一开始 `count2` 的增加速度比较慢呢**，个人认为：

虽然我们的鼠标一直在右边滑动，看起来是 `onMouseMove` 产生的高优先级一直在执行，`startTransition` 产生的低优先级任务不会执行，但是代码执行的速度肯定是比我们触发事件快的，又因为要调和的子 `fiber` 数量过多，所以是 `startTransition` 产生的低优先级任务会执行，但是每次没有执行完就被打断了，然后低优先级任务也是要执行一部分的，并不是说高优先级任务进来了，瞬间就能看到效果，时间分片也是以 `5ms` 为一帧的呀，所以就会造成一开始 `count2` 增加得比较慢，并且有点卡顿的感觉

参考资料

- [react 饥饿状态源码](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberLane.js#L384)

- [React 中的任务饥饿行为](https://juejin.cn/post/6923835053029982221)

- [《React 设计原理》(卡颂)](https://item.jd.com/13576643.html)
