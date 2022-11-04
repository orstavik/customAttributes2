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

  class Interval extends CustomAttr {
    upgrade() {
      if (this.name === this.type)
        return;
      let countDown = parseInt(this.suffix[1]) || Infinity;
      eventLoop.dispatch(new Event(this.type), this);
      this._interval = setInterval(_ => {
        if(!customReactions.getReactions(this.allFunctions).length)
          return;
        eventLoop.dispatch(new Event(this.type), this);
        //the countdown state is not reflected in the DOM. We could implement this by actually adding/removing the attribute with a new attribute. That would be ok.
        if (countDown-- === 1)
          clearInterval(this._interval);
      }, this.suffix[0]);
    }

    destructor() {
      clearInterval(this._interval);
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
  customAttributes.define("interval", Interval);
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

  function callFunction(obj, args, e) {
    for (let i = 0; i < args.length; i++) {
      obj = obj[toCamelCase(args[i])];
      if (obj instanceof Function)
        return obj(...args.slice(i + 1), e);
    }
    return obj;
  }

  function getProperty(obj, props) {
    for (let p of props)
      obj = obj[toCamelCase(p)];
    return obj;
  }

  function tthis(e, _, ...props) {
    return callFunction(this, props, e);
  }

  function sself(e, _, ...args) {
    return callFunction(self, args, e);
  }

  function prop(e, _, ...props) {
    return getProperty(e, props);
  }

  function call2(obj, _, ...props) {
    debugger;
    for (let i = 0; i < props.length; i++) {
      obj = obj[toCamelCase(props[i])];
      if (obj instanceof Function)
        return obj(...props.slice(i + 1), obj);
    }
    return obj;
  }

  function prop2(obj, _, ...props) {
    debugger;
    for (let p of props)
      obj = obj[toCamelCase(p)];
    return obj;
  }

  function this2(e, _, method, ...props) {
    debugger;
    return getReaction(method).call(this, this, method, ...props);
  }

  function window2(e, _, method, ...props) {
    debugger;
    return getReaction(method).call(this, self, method, ...props);
  }

  function e2(e, _, method, ...props) {
    debugger;
    return getReaction(method).call(this, e, method, ...props);
  }

  function getReaction(method) {
    return customReactions.getReactions(method)[0].Function;
  }

  function el2(e, _, method, ...props) {
    debugger;
    return getReaction(method).call(this, this.ownerElement, method, ...props);
  }

  function m2(e, _, prop, method, ...args) {
    debugger
    e[prop] = getReaction(method).call(this, e, method, ...args);
    return e;
  }

  function ddebugger(e) {
    debugger;
    return e;
  }

  customReactions.defineAll({
    // value,
    prevent: e => (e.preventDefault(), e),
    e: prop,

    dispatch,
    throttle,

    window: sself,
    plus,

    this: tthis,  //once => m-f-this_remove()

    on,
    style,
  });
})();
//m_res2_call_window_get-computed-style_...

//m_e_fun_prevent-default

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
(function () {

  function getReaction(method) {
    return customReactions.getReactions(method)[0].Function;
  }

  customReactions.defineAll({
    prop3: function (e, _, root, ...props) {
      let obj = getReaction(root).call(this, e);
      for (let prop of props)
        obj = obj[toCamelCase(prop)];
      return obj;
    },
    call3: function (e, _, root, ...props) {
      let obj = getReaction(root).call(this, e);
      for (let i = 0; i < props.length; i++) {
        obj = obj[toCamelCase(props[i])];
        if (obj instanceof Function)
          return obj(...props.slice(i + 1), e);
      }
      return obj;
    },
    this3: function (e) {
      return this;
    },
    window3: e => self,
    e3: e => e,
    el3: function (e) {
      return this.ownerElement;
    },
    m3: function m3(e, _, prop, method, ...args) {
      e[prop] = getReaction(method).call(this, e, method, ...args);
      return e;
    }
  });
  //m3_something_call3_window_get-computed-style_width
})();