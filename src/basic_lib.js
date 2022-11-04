//todo the below is the basic lib
(function () {
  function toPascalCase(strWithDash) {
    strWithDash = strWithDash[0].toUpperCase() + strWithDash.slice(1)
    return strWithDash.replace(/-([a-z])/g, g => g[1].toUpperCase());
  }

  function element(module, _, tag) {
    const ClassName = toPascalCase(tag);
    customElements.define(tag, module[ClassName] || window[ClassName]);
    return module;
  }

  function reaction(module, _, tag) {
    customReactions.define(tag, module[tag] || window[tag]);
    return module;
  }

  function attribute(module, _, tag) {
    const ClassName = toPascalCase(tag);
    customAttributes.define(tag, module[ClassName] || window[ClassName]);
    return module;
  }

  customReactions.defineAll({
    "element": element,
    "reaction": reaction,
    "attribute": attribute,
  });

  class Import extends CustomAttr {
    async upgrade() {
      const detail = await import(new URL(this.value, location.href).href);
      !this._stopped && eventLoop.dispatch(new CustomEvent(this.type, {detail}), this);
    }

    destructor() {
      this._stopped = true;
    }
  }

  class Ready extends CustomAttr {
    upgrade(i = 1) {
      if (this.name === this.type)
        return;
      customReactions.getReactions(this.allFunctions).length ?
        eventLoop.dispatch(new Event(this.type), this) :
        this._timer = setTimeout(_ => this.upgrade(i + 1), 4 ** i);
    }

    destructor() {
      clearTimeout(this._timer);
    }
  }

  customAttributes.define("ready", Ready);
  customAttributes.define("import", Import);
})();