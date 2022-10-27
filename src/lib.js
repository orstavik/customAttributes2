(function () {
  function toggleAttr(e, prefix) {
    const el = this.ownerElement;
    el.hasAttribute(prefix) ? el.removeAttribute(prefix) : el.setAttribute(prefix);
    return e;
  }

  function parentToggleAttr(e, prefix, suffix) {
    suffix = suffix?.toUpperCase();
    let el = this.ownerElement.parentElement;
    while (el && suffix && el.tagName !== suffix)
      el = el.parentElement;
    if (!el)
      return;
    el.hasAttribute(prefix) ? el.removeAttribute(prefix) : el.setAttribute(prefix);
    return e;
  }

  function newEvent(e, prefix) {
    return eventLoop.dispatch(new Event(prefix), this.ownerElement), e;
  }

  function cloneEvent(e, prefix) {
    //todo the targeting here is broken, because we don't update the target and path properties on the event during in our eventLoop so far.
    return new e.constructor(prefix, e);
  }

  function customEvent(data, prefix) {
    return new CustomEvent(prefix, data);
  }

  function dispatch(e, _, querySelector) {
    const target = querySelector ? document.querySelector(querySelector) : this.ownerElement;
    eventLoop.dispatch(e, target);
    return e;
  }

  function dispatchCustom(e, _, name) {
    return dispatch.call(this, customEvent.call(this, e, name));
  }

  function dispatchClone(e, _, name) {
    return dispatch.call(this, cloneEvent.call(this, e, name));
  }

  function hasKey(e, prefix) {
    if (e[prefix + "Key"])
      return e;
  }

  function once(e) {
    return this.ownerElement.removeAttribute(this.name), e;
  }

  function toCamelCase(strWithDash) {
    return strWithDash.replace(/-([a-z])/g, g => g[1].toUpperCase());
  }

  function ownerCallback(e, _, ...methods) {
    const element = this.ownerElement;
    //1. get all the methods. If one method is missing, the reaction throws
    if (!methods.length) methods = this.value.split(" ").map(toCamelCase);
    methods = methods.map(method => {
      if (!(method in element))
        throw `'.${method}' is not a function on element <${element.tagName}>. Is it a typo?`;
      return method;
    });
    //2. run each method one by one
    for (let method of methods)
      element[method](e);
    //3. don't forget to return the e!
    return e;
  }

  function cssClass(e, css, onOff) {
    if (onOff === undefined || onOff === "on")
      this.ownerElement.classList.add(css);
    else if (onOff === "off")
      this.ownerElement.classList.remove(css);
    return e;
  }

  async function fetch(e, _, type) {       //fetch_json and fetch_text
    return await (await fetch(this.value))[type]();
  }

  window.lib = {
    toggleAttr,
    parentToggleAttr,
    newEvent,
    cloneEvent,
    customEvent,
    dispatch,
    dispatchCustom,
    dispatchClone, //todo untested
    hasKey,
    once,
    ownerCallback,
    cssClass,
    toCamelCase,
    fetch  //todo untested
  };
})();