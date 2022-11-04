function toCamelCase(strWithDash) {
  return strWithDash.replace(/-([a-z])/g, g => g[1].toUpperCase());
}

function toPascalCase(strWithDash) {
  return strWithDash[0].toUpperCase() + toCamelCase(strWithDash.slice(1));
}

//:element, :attribute, :reaction
(function () {
  function getModule(module, ClassName) {
    return module[ClassName] || module.detail?.[ClassName] || window[ClassName];
  }

  function element(module, _, tag) {
    customElements.define(tag, getModule(module, toPascalCase(tag)));
    return module;
  }

  function attribute(module, _, tag) {
    customAttributes.define(tag, getModule(module, toPascalCase(tag)));
    return module;
  }

  function reaction(module, _, tag) {
    customReactions.define(tag, getModule(module, toCamelCase(tag)));
    return module;
  }

  customReactions.defineAll({
    "element": element,
    "reaction": reaction,
    "attribute": attribute,
  });
})();

//import:, ready:, timeout:, raf:
(function () {
  function dispatchWhenReactionReady(attr, event, delay = 4, i = 0) {
    customReactions.getReactions(attr.allFunctions).length ?
      eventLoop.dispatch(event, attr) :
      attr._timer = setTimeout(_ => dispatchWhenReactionReady(this, event, delay, ++i), delay ** i);
  }

  class Import extends CustomAttr {
    async upgrade() {
      if (!this.value)
        return;
      this._originalValue = this.value;
      const detail = await import(new URL(this.value, location.href).href);
      if (!this._stopped)
        dispatchWhenReactionReady(this, new CustomEvent(this.type, {detail}), this.suffix[0]);
    }

    changeCallback() {  //make the import .value immutable.
      this.value = this._originalValue;
    }

    destructor() {
      this._stopped = true;
      clearTimeout(this._timer);
    }
  }

  class Ready extends CustomAttr {
    upgrade() {
      if (this.name !== this.type)
        Promise.resolve().then(_ => dispatchWhenReactionReady(this, new Event(this.type), this.suffix[0]));
    }

    destructor() {
      clearTimeout(this._timer);
    }
  }

  class Timeout extends CustomAttr {
    upgrade() {
      if (this.name !== this.type)
        this._timer = setTimeout(_ => this._trigger(1, this.suffix[1]), this.suffix[0]);
    }

    _trigger(i, delay = 4) {
      customReactions.getReactions(this.allFunctions).length ?
        eventLoop.dispatch(new Event(this.type), this) :
        this._timer = setTimeout(_ => this._trigger(++i, delay), delay ** i);
    }

    destructor() {
      clearTimeout(this._timer);
    }
  }

  class Raf extends CustomAttr {
    upgrade() {
      this._count = parseInt(this.suffix[0]) || Infinity;
      this._timer = requestAnimationFrame(_ => this.trigger());
    }

    trigger() {
      if (!this._count)
        this.destructor();
      if (!customReactions.getReactions(this.allFunctions).length)
        return;
      this._count--;
      eventLoop.dispatch(new Event(this.type), this);
    }

    destructor() {
      cancelAnimationFrame(this._timer);
    }
  }

  customAttributes.define("ready", Ready);
  customAttributes.define("import", Import);
  customAttributes.define("timeout", Timeout);
  customAttributes.define("raf", Raf);
})();

(function () {
  function value() {
    return this.value;
  }

  function eventProps(e, ...props) {
    for (let p of props)
      e = e[toCamelCase(p)];
    return e;
  }

  function once(e) {
    return this.ownerElement.removeAttribute(this.name), e;
  }

  function dispatch(e, _, type) {
    const e2 = e instanceof Event ? new e.constructor(type, e) : new CustomEvent(type, {detail: e});
    eventLoop.dispatch(e2, this.ownerElement);
    return e2;
  }

  function on(e, _, ...methods) {
    for (let method of methods)
      this.ownerElement[method].call(this.ownerElement, e);
    return e;
  }

  function math(e, _, method, ...args) {
    return window.Math[method](e, ...args);
  }

  function plus(value, plus, ...addends) {
    for (let addend of addends)
      value += addend;
    return value;
  }

  function _console(e, _, channel, ...values) {
    return console[channel](...values, e);
  }

  function style(e, _, prop, value = e) {
    return this.ownerElement.style.setProperty(prop, value), e;
  }

  const throttleRegister = new WeakMap();

  function throttle(value) {
    const primitive = value instanceof Object ? JSON.stringify(value) : value;
    if (throttleRegister.get(this) !== primitive)
      return throttleRegister.set(this, primitive), value;
  }

  function sself(e, _, ...args) {
    let obj = self;
    for (let i = 0; i < args.length; i++) {
      obj = obj[toCamelCase(args[i])];
      if (obj instanceof Function)
        return obj(e, args.slice(i + 1));
    }
    return obj;
  }

  function tthis(e, _, ...args) {
    let obj = this;
    for (let i = 0; i < args.length; i++) {
      obj = obj[toCamelCase(args[i])];
      if (obj instanceof Function)
        return obj(e, args.slice(i + 1));
    }
    return obj;
  }

  function prop(e,_, ...props){
    for (let p of props)
      e = e[toCamelCase(p)];
    return e;
  }

  customReactions.defineAll({
    value,
    once,
    console: _console,
    detail: eventProps,
    target: eventProps,
    dispatch,
    timestamp: e => e.timeStamp,
    prevent: e => (e.preventDefault(), e),
    on,
    math,
    style,
    throttle,
    plus,
    self: sself,
    this: tthis,
    prop
  });
})();

//border-box: and content-box:
(function () {
  class ResizeAttr extends CustomAttr {
    upgrade() {
      this._obs = new ResizeObserver(([detail]) => eventLoop.dispatch(new CustomEvent(this.type, {detail}), this));
      this._obs.observe(this.ownerElement, {box: this.type});
    }

    destructor() {
      this._obs.disconnect();
    }
  }

  customAttributes.define("border-box", ResizeAttr);
  customAttributes.define("content-box", ResizeAttr);
  customAttributes.define("device-pixel-content-box", ResizeAttr);
})();