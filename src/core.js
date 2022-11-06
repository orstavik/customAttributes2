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
        const parent = obj;
        obj = obj[toCamelCase(props[i])];
        if (obj instanceof Function)
          return obj.call(parent, ...props.slice(i + 1), e);
      }
      return obj;
    },
    apply3: function (e, _, root, ...props) {
      let obj = getReaction(root).call(this, e);
      for (let i = 0; i < props.length; i++) {
        const parent = obj;
        obj = obj[toCamelCase(props[i])];
        if (obj instanceof Function)
          return obj.apply(parent, [...props.slice(i + 1), ...e]);
      }
      return obj;
    },
    this3: function (e) {
      return this;
    },
    window3: e => window,
    e3: e => e,
    el3: function (e) {
      return this.ownerElement;
    },
    new3: function new3(e, _, constructor, ...args) {
      //todo not sure that the self is the right reference frame here
      return new self[toCamelCase(constructor)](...args, e);
    },
    m3: function m3(e, _, prop, method, ...args) {
      e[prop] = getReaction(method).call(this, e, method, ...args);
      return e;
    },
    push3: function push3(e, _, method, ...args) {
      const value = getReaction(method).call(this, e, method, ...args);
      e.push(value);
      return e;
    }
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