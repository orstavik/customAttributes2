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
        if (!customReactions.getReactions(this.allFunctions).length)
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

  function doDots(dots, thiz, e) {
    dots = dots.split(".");
    let obj = dots[0] === "e" ? e : dots[0] === "this" ? thiz : window;
    let parent;
    for (let i = obj === window ? 0 : 1; i < dots.length; i++)
      parent = obj, obj = obj[toCamelCase(dots[i])];
    return {obj, parent};
  }

  customReactions.defineAll({
    this: function (e) {
      return this;
    },
    window: e => window,
    e: e => e,                   //todo this should be anything with a `.`
    x4: function call(e, _, prefix, ...args) {
      const {parent, obj} = doDots(prefix, this, e);
      return obj instanceof Function ? obj.call(parent, ...args, e) : obj;
    },                           //todo this should be anything starting with `...` and then the rest.
    a4: function apply(e, _, prefix, ...args) {
      const {parent, obj} = doDots(prefix, this, e);
      return obj.apply(parent, [...args, ...e]);
    },                                         //todo this doesn't need to be anything other than what it is
    new: function _new(e, _, constructor, ...args) {
      return new window[toCamelCase(constructor)](...args, e);
    },
    m3: function monadish(e, _, prop, method, ...args) {
      const value = getReaction(method).call(this, e, method, ...args);
      if (e instanceof Array)
        Number.isInteger(+prop) ?
          e.splice(prop < 0 ? Math.max(e.length + 1 + prop, 0) : Math.min(prop, e.length), 0, value) :
          e.push(value);
      else
        e[prop] = value;
      return e;
    },
  });
  //m3_something_call3_window_get-computed-style_width

  const throttleRegister = new WeakMap();

  function throttle(value) {
    const primitive = value instanceof Object ? JSON.stringify(value) : value;
    if (throttleRegister.get(this) !== primitive)
      return throttleRegister.set(this, primitive), value;
  }

  customReactions.defineAll({
    throttle,
    plus: function plus(value, plus, ...addends) {
      for (let addend of addends)
        value += addend;
      return value;
    },
    debugger: function (e) {
      debugger;
      return e;
    }
  });
})();