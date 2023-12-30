---
sidebar_position: 6
---

#### Promise 源码实现及分析(分析写在注释里面了)

```js
// xx.xx.xx.xx：对应Promise/A+的第几条规范

const resolvePromise = (promise2, x, resolve, reject) => {
  // 自己等待自己，永远不可能完成，所以需要抛出错误 2.3.1
  // const p1 = new Promise((resovle, reject) => {
  //   resovle(1);
  // }).then((v) => {
  //   return p1;
  // });
  if (promise2 === x) {
    return reject(new TypeError('Chaining cycle detected for promise #<Promise>'));
  }
  // 源码中已经对同时调用 resolve 和 reject 的情况做了处理，
  // 所以这里主要是针对 return 时调用了第三方的 promise 库的情况，
  // 第三方的 promise 库有可能既调 resolve 又调 reject 的情况 但是它又没有对同时调用 resolve 和 reject 的情况做了处理，
  // 这是无法左右的，这里主要是把不符合规范的 promise 变成符合的
  // resovle和reject只能调用一次 2.3.3.3.3
  // new Promise((resolve, reject) => {
  //   resolve(1);
  // }).then((v) => {
  //   return {
  //     then: (resolve, reject) => {
  //       resolve(1)
  //       resolve(1)
  //       or
  //       reject(2);
  //       reject(2)
  //       or
  //       resolve(3);
  //       reject(3)
  //     },
  //   };
  // });
  let isCalled = false;

  // onFulfilled和onFulfilled调用的返回值是对象或者函数 2.3.3
  if (x !== null && (typeof x === 'object' || typeof x === 'function')) {
    try {
      // x 对象不可知，访问 x 的 then 属性可能会导致一些副作用，所以取出来，只访问一次。2.3.3.1
      // let num = 1;
      // let obj = {};
      // Reflect.defineProperty(obj, 'then', {
      //   get() {
      //     num++;
      //     console.log(num);
      //     return undefined;
      //   },
      // });
      let then;

      // 如果取 x.then 的值时抛出错误 e ，则以 e 为据因拒绝 promise 2.3.3.2
      try {
        then = x.then;
      } catch (e) {
        reject(e);
      }

      // x有then方法的情况（x有then方法只是有可能是promise对象）2.3.2 & 2.3.3
      if (typeof then === 'function') {
        // 2.3.3.3
        then.call(
          x,
          // 2.3.3.3.1
          y => {
            if (isCalled) return;
            isCalled = true;
            resolvePromise(promise2, y, resolve, reject);
          },
          // 2.3.3.3.2
          r => {
            if (isCalled) return;
            isCalled = true;
            reject(r);
          }
        );
      } else {
        // 如果 x.then 是个对象或者函数的话，then方法返回的Promise实例的状态直接变成成功状态
        resolve(x);
      }
    } catch (err) {
      // 2.3.3.2 & 2.3.3.3.4
      if (isCalled) return;
      isCalled = true;
      reject(err);
    }
  } else {
    // onFulfilled 和 onFulfilled 调用的返回值是普通值的话，then方法返回的Promise实例的状态直接变成成功状态 2.3.4
    resolve(x);
  }
};

const processThen = (promise2, onStatusChange, valueOrReason, resolve, reject) => {
  // 2.2.7.2
  try {
    const x = onStatusChange(valueOrReason);
    resolvePromise(promise2, x, resolve, reject);
  } catch (err) {
    reject(err);
  }
};

/**
 * @see https://promisesaplus.com/ Promise/A+规范（英文版）
 * @see https://www.ituring.com.cn/article/66566 Promise/A+（中文版）
 */
class Promise {
  // Promise对应的三种状态，等待中，已解决，已拒绝
  static PENDING = 'pending';
  static RESOLVED = 'resolved';
  static REJECTED = 'rejected';
  static resolve = value => {
    return new Promise(resolve => {
      resolve(value);
    });
  };
  static reject = reason => {
    return new Promise((_, reject) => {
      reject(reason);
    });
  };

  constructor(executor) {
    // 如果new Promise时传进来的参数不是函数则抛出错误
    if (typeof executor !== 'function') {
      throw new Error(`TypeError: Promise resolver ${executor} is not a function`);
    }

    // 初始化Promise实例的一些参数
    this.state = 'pending';
    this.value = undefined;
    this.reason = undefined;

    // onFulfilledCallbacks数组用来存then方法的第一个参数
    // onRejectedCallbacks数组用来存then方法的第二个参数
    // 当Promise实例的状态是'pending'的时候回调才会被收集（观察者模式 状态是'pending'收集依赖 -> 状态改变后触发所有依赖）
    // 2.2.6
    this.onFulfilledCallbacks = [];
    this.onRejectedCallbacks = [];

    // 一旦Promise实例的状态从'pending' -> 'resolved' || 'rejected'就不可以再被改变，Promise的状态不可逆 2.1.1 & 2.1.2 & 2.1.3
    // 调用该方法后Promise实例的状态会从'pending' —> 'resolved'，并且执行所有成功回调
    const resolve = value => {
      // resolve函数的参数除了正常的值以外，还可能是另一个 Promise 实例,这时p1的状态就会传递给p2,p2的回调函数就会等待p1的状态改变
      // new Promise((resolve, reject) => {
      //   resolve(new Promise((resolve, reject) => {
      //      .....
      //   }))
      // })
      if (this.state === Promise.PENDING) {
        if (value instanceof Promise) {
          return value.then(resolve, reject);
        }

        this.state = 'resolved';
        this.value = value;

        this.onFulfilledCallbacks.forEach(cb => cb());
      }
    };

    // 调用该方法后Promise实例的状态会从'pending' —> 'rejected'，并且执行所有失败回调
    const reject = reason => {
      if (this.state === Promise.PENDING) {
        this.state = 'rejected';
        this.reason = reason;

        this.onRejectedCallbacks.forEach(cb => cb());
      }
    };
    try {
      // 立即执行，将 resolve 和 reject 函数传给使用者
      executor(resolve, reject);
    } catch (err) {
      // 发生异常时执行失败逻辑
      reject(err);
    }
  }

  then(onFulfilled, onRejected) {
    // 如果 onFulfilled或onRejected 不是函数，他们必须被忽略 2.2.1 & 2.2.7.3 & 2.2.7.4
    if (typeof onFulfilled !== 'function') onFulfilled = value => value;
    if (typeof onRejected !== 'function')
      onRejected = reason => {
        throw reason;
      };
    const promise2 = new Promise((resolve, reject) => {
      // 2.2.2 & 2.2.3
      switch (this.state) {
        case Promise.RESOLVED:
          // 由于原生的 Promise 是V8引擎提供的微任务，我们无法还原V8引擎的实现，所以这里使用 queueMicrotask 模拟异步，所以原生的是微任务，这里是宏任务。
          queueMicrotask(() => {
            processThen(promise2, onFulfilled, this.value, resolve, reject);
          });
          break;
        case Promise.REJECTED:
          queueMicrotask(() => {
            processThen(promise2, onRejected, this.reason, resolve, reject);
          });
          break;
        case Promise.PENDING:
          this.onFulfilledCallbacks.push(() => {
            queueMicrotask(() => {
              processThen(promise2, onFulfilled, this.value, resolve, reject);
            });
          });
          this.onRejectedCallbacks.push(() => {
            queueMicrotask(() => {
              processThen(promise2, onRejected, this.reason, resolve, reject);
            });
          });
          break;
        default:
          break;
      }
    });
    // 2.2.7
    return promise2;
  }

  // 相当于一个没有成功的 then
  catch(errorCallback) {
    return this.then(null, errorCallback);
  }

  // finally 表示不是最终的意思，而是无论如何都会执行的意思。
  // 如果返回一个 promise 会等待这个 promise 也执行完毕。
  // 如果返回的是成功的 promise，会采用上一次的结果；
  // 如果返回的是失败的 promise，会用这个失败的结果，传到 catch 中
  finally(callback) {
    return this.then(
      value => {
        return Promise.resolve(callback()).then(() => value);
      },
      reason => {
        return Promise.resolve(callback()).then(() => {
          throw reason;
        });
      }
    );
  }
}

// promise案例测试 npm init -y npm i promises-aplus-tests 运行该文件
// const promisesAplusTests = require('promises-aplus-tests');

// Promise.defer = Promise.deferred = function () {
//   let dfd = {};
//   dfd.promise = new Promise((resolve, reject) => {
//     dfd.resolve = resolve;
//     dfd.reject = reject;
//   });
//   return dfd;
// };

// promisesAplusTests(Promise, function (err) {
//   console.log(err);
// });

Promise.all = function (promises) {
  const results = [];

  return new Promise((resolve, reject) => {
    promises.forEach((promise, i) => {
      Promise.resolve(promise).then(result => {
        results[i] = result;

        Object.keys(results).length === promises.length && resolve(results);
      }, reject);
    });
  });
};

Promise.race = function (promises) {
  return new Promise((resolve, reject) => {
    promises.forEach(promise => {
      Promise.resolve(promise).then(resolve, reject);
    });
  });
};

Promise.any = function (promises) {
  const results = [];

  return new Promise((resolve, reject) => {
    promises.forEach((promise, i) => {
      Promise.resolve(promise).then(resolve, err => {
        results[i] = err;

        Object.keys(results).length === promises.length && reject(results);
      });
    });
  });
};

Promise.allSettled = function (promises) {
  const results = [];

  return new Promise((resolve, reject) => {
    function processResult(result, index, status) {
      results[index] = { status, value: result };
      Object.keys(results).length === promises.length && resolve(results);
    }

    promises.forEach((promise, i) => {
      Promise.resolve(promise).then(
        res => {
          processResult(res, i, 'fulfilled');
        },
        err => {
          processResult(err, i, 'rejected');
        }
      );
    });
  });
};
```
