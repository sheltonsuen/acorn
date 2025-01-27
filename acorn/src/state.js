import { keywords, reservedWords } from "./identifier.js"
import { getOptions } from "./options.js"
import { SCOPE_ASYNC, SCOPE_CLASS_STATIC_BLOCK, SCOPE_DIRECT_SUPER, SCOPE_FUNCTION, SCOPE_GENERATOR, SCOPE_SUPER, SCOPE_TOP } from "./scopeflags.js"
import { types as tt } from "./tokentype.js"
import { wordsRegexp } from "./util.js"
import { lineBreak } from "./whitespace.js"

export class Parser {
  constructor(options, input, startPos) {
    this.options = options = getOptions(options)
    this.sourceFile = options.sourceFile

    // 这两个属性都是正则，用来判断是偶是某个关键字 /^(?:let|const|var)$/
    this.keywords = wordsRegexp(keywords[options.ecmaVersion >= 6 ? 6 : options.sourceType === "module" ? "5module" : 5])
    let reserved = ""
    if (options.allowReserved !== true) {
      reserved = reservedWords[options.ecmaVersion >= 6 ? 6 : options.ecmaVersion === 5 ? 5 : 3]
      if (options.sourceType === "module") reserved += " await"
    }
    this.reservedWords = wordsRegexp(reserved)
    let reservedStrict = (reserved ? reserved + " " : "") + reservedWords.strict
    this.reservedWordsStrict = wordsRegexp(reservedStrict)
    this.reservedWordsStrictBind = wordsRegexp(reservedStrict + " " + reservedWords.strictBind)
    this.input = String(input)

    // Used to signal to callers of `readWord1` whether the word
    // contained any escape sequences. This is needed because words with
    // escape sequences must not be interpreted as keywords.
    this.containsEsc = false

    // Set up token state

    // 可以指定开始的位置
    // The current position of the tokenizer in the input.
    if (startPos) {
      this.pos = startPos
      this.lineStart = this.input.lastIndexOf("\n", startPos - 1) + 1
      this.curLine = this.input.slice(0, this.lineStart).split(lineBreak).length
    } else {
      this.pos = this.lineStart = 0

      // curLine 这个变量得注意一下，这个变量不是0-indexed
      this.curLine = 1
    }

    // Properties of the current token:
    // Its type
    this.type = tt.eof
    // For tokens that include more information than their type, the value
    this.value = null
    // Its start and end offset
    this.start = this.end = this.pos
    // And, if locations are used, the {line, column} object
    // corresponding to those offsets
    this.startLoc = this.endLoc = this.curPosition()

    // Position information for the previous token
    this.lastTokEndLoc = this.lastTokStartLoc = null
    this.lastTokStart = this.lastTokEnd = this.pos

    // The context stack is used to superficially track syntactic
    // context to predict whether a regular expression is allowed in a
    // given position.
    this.context = this.initialContext()
    this.exprAllowed = true

    // Figure out if it's a module code.
    this.inModule = options.sourceType === "module"
    this.strict = this.inModule || this.strictDirective(this.pos)

    // Used to signify the start of a potential arrow function
    this.potentialArrowAt = -1
    this.potentialArrowInForAwait = false

    // Positions to delayed-check that yield/await does not exist in default parameters.
    this.yieldPos = this.awaitPos = this.awaitIdentPos = 0
    // Labels in scope.
    this.labels = []
    // Thus-far undefined exports.
    this.undefinedExports = Object.create(null)

    // If enabled, skip leading hashbang line.
    if (this.pos === 0 && options.allowHashBang && this.input.slice(0, 2) === "#!")
      this.skipLineComment(2)

    // Scope tracking for duplicate variable names (see scope.js)
    this.scopeStack = []
    this.enterScope(SCOPE_TOP)

    // For RegExp validation
    this.regexpState = null

    // The stack of private names.
    // Each element has two properties: 'declared' and 'used'.
    // When it exited from the outermost class definition, all used private names must be declared.
    this.privateNameStack = []
  }

  parse() {
    // program: It is possible to parse multiple files into a single AST by passing the tree produced by parsing the first file as the program option in subsequent parses.
    // This will add the toplevel forms of the parsed file to the "Program" (top) node of an existing parse tree.
    let node = this.options.program || this.startNode()
    this.nextToken()
    return this.parseTopLevel(node)
  }

  get inFunction() { return (this.currentVarScope().flags & SCOPE_FUNCTION) > 0 }

  get inGenerator() { return (this.currentVarScope().flags & SCOPE_GENERATOR) > 0 && !this.currentVarScope().inClassFieldInit }

  get inAsync() { return (this.currentVarScope().flags & SCOPE_ASYNC) > 0 && !this.currentVarScope().inClassFieldInit }

  get canAwait() {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      let scope = this.scopeStack[i]
      if (scope.inClassFieldInit || scope.flags & SCOPE_CLASS_STATIC_BLOCK) return false
      if (scope.flags & SCOPE_FUNCTION) return (scope.flags & SCOPE_ASYNC) > 0
    }
    return (this.inModule && this.options.ecmaVersion >= 13) || this.options.allowAwaitOutsideFunction
  }

  get allowSuper() {
    const {flags, inClassFieldInit} = this.currentThisScope()
    return (flags & SCOPE_SUPER) > 0 || inClassFieldInit || this.options.allowSuperOutsideMethod
  }

  get allowDirectSuper() { return (this.currentThisScope().flags & SCOPE_DIRECT_SUPER) > 0 }

  get treatFunctionsAsVar() { return this.treatFunctionsAsVarInScope(this.currentScope()) }

  get allowNewDotTarget() {
    const {flags, inClassFieldInit} = this.currentThisScope()
    return (flags & (SCOPE_FUNCTION | SCOPE_CLASS_STATIC_BLOCK)) > 0 || inClassFieldInit
  }

  get inClassStaticBlock() {
    return (this.currentVarScope().flags & SCOPE_CLASS_STATIC_BLOCK) > 0
  }

  static extend(...plugins) {
    let cls = this
    for (let i = 0; i < plugins.length; i++) cls = plugins[i](cls)
    return cls
  }

  static parse(input, options) {
    return new this(options, input).parse()
  }

  static parseExpressionAt(input, pos, options) {
    let parser = new this(options, input, pos)
    parser.nextToken()
    return parser.parseExpression()
  }

  static tokenizer(input, options) {
    return new this(options, input)
  }
}
