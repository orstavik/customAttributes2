//import:, ready:, timeout:, raf:
(function () {
  function dispatchWhenReactionReady(attr, event, delay = 4, i = 0) {
    attr.ready ?
      eventLoop.dispatch(event, attr) :
      attr._timer = setTimeout(_ => dispatchWhenReactionReady(attr, event, delay, ++i), delay ** i);
  }

  class Import extends CustomAttr {
    async upgrade() {
      if (!this.value)
        return;
      this._originalValue = this.value;
      const detail = await import(new URL(this.value, this.baseURI).href);
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
        if (!this.ready)
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
      this.ready ?
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
      if (!this.ready)
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
  const throttleRegister = new WeakMap();

  customReactions.defineAll({
    new: function _new(e, _, constructor, ...args) {
      return new window[ReactionRegistry.toCamelCase(constructor)](...args, e);
    },
    m: function monadish(e, _, prop, ...nestedReaction) {
      const reaction = customReactions.getReaction(nestedReaction.join("_"));
      const value = reaction.run(this, e);
      if (e instanceof Array && !prop)
        e.push(value);
      else if (e instanceof Array && Number.isInteger(+prop))
        e.splice(prop < 0 ? Math.max(e.length + 1 + prop, 0) : Math.min(prop, e.length), 0, value);
      else if (prop)
        e[prop] = value;
      return e;
    },
    //todo untested.
    plus: (s, _, ...as) => as.reduce((s, a) => s + a, s),
    minus: (s, _, ...as) => as.reduce((s, a) => s - a, s),
    times: (s, _, ...as) => as.reduce((s, a) => s * a, s),
    divide: (s, _, ...as) => as.reduce((s, a) => s / a, s),
    percent: (s, _, ...as) => as.reduce((s, a) => s % a, s),
    factor: (s, _, ...as) => as.reduce((s, a) => s ** a, s),
    and: (s, _, ...as) => as.reduce((s, a) => s && a, s),
    or: (s, _, ...as) => as.reduce((s, a) => s || a, s),
    //todo double or triple equals??
    equals: (s, _, ...as) => as.reduce((s, a) => s == a, s),
    number: n => Number(n),  //this is the same as .-number_e. Do we want it?

    debugger: function (e) {
      debugger;
      return e;
    },

    throttle: function throttle(value) {
      const primitive = value instanceof Object ? JSON.stringify(value) : value;
      if (throttleRegister.get(this) !== primitive)
        return throttleRegister.set(this, primitive), value;
    },

    define: function define(Def, _, tag) {
      if (Def.prototype instanceof CustomAttr)
        customAttributes.define(tag, Def);
      else if (Def.prototype instanceof HTMLElement)
        customElements.define(tag, Def);
      else if (Def instanceof Function)
        customReactions.define(tag, Def);
      else
        throw "You cannot define a class that isn't either a CustomAttr, an HTMLElement, or a Function.";
    }
  });
})();