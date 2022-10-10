(function () {
  function logComputedStyle(e, _, suffix) {
    console.log(getComputedStyle(this.ownerElement)[lib.toCamelCase(suffix)]);
    return e;
  }

  window.testLib = {
    logComputedStyle
  };
})();