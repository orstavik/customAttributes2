class StateMachineAttr extends CustomAttr {
  static #uid = 1;

  upgrade() {
    this._seenEvents = new WeakSet();
    const uid = StateMachineAttr.#uid++;
    this._transitions = this.constructor.fsm();
    const toBeBound = new Set();
    const toBeBoundStatic = new Set();
    for (let state in this._transitions) {
      for (let i = 0; i < this._transitions[state].length; i++) {
        this._transitions[state][i] = this._transitions[state][i]
          .replaceAll(/:([^:_]+)/g, (full, prefix) => {
            if (prefix in this) {
              toBeBound.add(prefix);
              return full + uid;
            } else if (prefix in this.constructor)
              toBeBoundStatic.add(prefix);
            return full;
          });
      }
    }
    for (let prefix of toBeBound)
      customReactions.define(prefix + uid, this[prefix].bind(this));
    for (let prefix of toBeBoundStatic)
      customReactions.define(prefix, this.constructor[prefix]);
  }

  changeCallback(newState) {
    if (newState === undefined)
      this.transition(0, 0, Object.keys(this._transitions)[0]);
  }

  seen(e) {
    return this._seenEvents.has(e) ? undefined : (this._seenEvents.add(e), e);
  }

  detail(e, _, uid) {
    if (e.detail === uid)
      return e;
  }

  observe(e) {
    this.ownerElement.setAttribute("_eventgrab:detail_" + e.uid + ":reset");
    return e;
  }

  reset(e) {
    for (let attr of this.ownerElement.attributes)
      if (attr.name.startsWith("_eventgrab:detail_"))
        this.ownerElement.removeAttribute(attr.name);
    return e;
  }

  grab(e) {
    for (let attr of this.ownerElement.attributes) {
      const uid = attr.name.match(/^_eventgrab:detail_(\d+)/)?.[1];
      if (uid !== undefined) {
        this.ownerElement.removeAttribute(attr.name);
        eventLoop.dispatch(new CustomEvent("eventgrab", {detail: uid}));
      }
    }
    return e;
  }

  transition(e, _, newState) {
    const el = this.ownerElement;
    const oldState = this._state;
    this._state = newState;
    if (oldState)
      for (let attr of this._transitions[oldState])
        el.removeAttribute(attr);
    for (let attr of this._transitions[newState])
      el.setAttribute(attr, "");
    return e;
  }
}