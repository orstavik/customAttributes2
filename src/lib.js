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

  function dispatchDetail(e, prefix, name = prefix) {
    return dispatch.call(this, customEvent.call(this, e, name));
  }

  function dispatchClone(e, prefix, type = prefix) {
    const c = new e.constructor(type, e);
    return eventLoop.dispatch(c, this.ownerElement), c;
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

  async function _fetch(body, _, type = "text", method = "GET") { //fetch_json and fetch_text_POST
    return await (await fetch(this.value, method.toUpperCase() === "POST" ? {method, body} : undefined))[type]();
  }

  function elementProp(_, prop) {
    return this.ownerElement[prop];
  }

  function eventProp(e, prop) {
    return e[prop];
  }

  window.lib = {
    toggleAttr,
    parentToggleAttr,
    newEvent,
    cloneEvent,
    customEvent,
    dispatch,
    dispatchDetail,
    dispatchClone, //todo untested
    hasKey,
    once,
    ownerCallback,
    cssClass,
    toCamelCase,
    fetch: _fetch,  //todo untested
    elementProp,    //todo untested
    eventProp       //todo untested
  };
})();