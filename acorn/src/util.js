const {hasOwnProperty, toString} = Object.prototype

export const hasOwn = Object.hasOwn || ((obj, propName) => (
  hasOwnProperty.call(obj, propName)
))

export const isArray = Array.isArray || ((obj) => (
  toString.call(obj) === "[object Array]"
))

export function wordsRegexp(words) {
  // 嗯，这儿这个还是动态创建的关键字，感觉没有必要，直接template string, 原地创建可能更直观
  // TODO: refactor, use template string
  return new RegExp("^(?:" + words.replace(/ /g, "|") + ")$")
}

export const loneSurrogate = /[\uD800-\uDFFF]/u
