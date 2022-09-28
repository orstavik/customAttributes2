class EventFilterRegistry {
  define(prefix, Function) {
    if (!Function.prototype)
      throw `Arrow functions cannot be bound as customEventFilters.`;
    const usedFilterName = Object.keys(this).find(name => this[name] === Function);
    if (usedFilterName === prefix)
      return console.warn(`Defining the event filter "${prefix}" multiple times.`);
    if (usedFilterName)
      throw `Function: "${Function.name}" is already defined as event filter "${usedFilterName}".`;
    const overlapDefinition = Object.keys(this).find(old => prefix.startsWith(old) || old.startsWith(prefix));
    if (overlapDefinition)
      throw `The eventFilter prefix: "${prefix}" is already defined as "${overlapDefinition}".`;
    this[prefix] = Function;
  }

  #findAndBind(name) {
    if (this[name])
      return {Definition: this[name], prefix: name, suffix: ""};
    for (let prefix in this) {
      if (name.startsWith(prefix)) {
        let suffix = name.substring(prefix.length);
        if (suffix[0] === '_') suffix = suffix.substring(1).split("_");
        return {Definition: this[prefix], prefix, suffix};
      }
    }
  }

  #lists = {};

  getFilterFunctions(filter) {
    if (!filter)
      return;
    if (this.#lists[filter])
      return this.#lists[filter];
    const res = [];
    let filters = filter.split(":");
    for (let i = 0; i < filters.length; i++) {
      res[i] = this.#findAndBind(filters[i]);
      if (!res[i])
        return;
    }
    return this.#lists[filter] = res;
  }

  callFilterWithDefaultActionOnTheDefaultAttr(at, event) {
    const res = this.#callFilterImpl(at.filterFunction, at, event, false);
    // if(res!== false) //todo
    event.defaultAction = at;        //todo this needs to set the default action to be {attr, res};
  }

  //todo
  // 3. passive? This should probably be a special first filter ":passive". This will add a special event listener with the passive argument set to true on the target node. This would also need to be cleaned up.
  callFilter(at, event) {
    //todo default action attributes are ignored when the default action has already been set.
    if (at.defaultAction && (event.defaultAction || event.defaultPrevented))
      return;
    if (at.defaultAction)
      return this.callFilterWithDefaultActionOnTheDefaultAttr(at, event);
    this.#callFilterImpl(at.filterFunction, at, event, at.once);
  }

  #callFilterImpl(filter, at, event, once) {
    let inputOutput = event;
    try {
      for (let {Definition, prefix, suffix} of this.getFilterFunctions(filter) || [])
        inputOutput = Definition.call(at, event, suffix, prefix); //todo       inputOutput);
    } catch (err) {
      return false;      //todo we need to handle this
    }
    if (once)
      at.ownerElement.removeAttribute(at.name);                        //todo the once feels good to do on the outside actually
    return inputOutput;
  }

  callDefaultAction(at, event) {
    return this.#callFilterImpl(at.defaultAction, at, event, at.once);
  }
}

window.customEventFilters = new EventFilterRegistry();

// chain(filters, key = filters.join(":")) {
//   if (this[key])
//     return this[key];
//   const ready = [];
//   for (let i = 0; i < filters.length; i++) {
//     ready[i] = this.findAndBind(filters[i]);
//     if (!ready)
//       return false;
//   }
//   return this[key] = function compound(...args) {               //do we need compound function here?? don't think so.
//     for (let func of ready) {
//       try {
//         const result = func.call(this, ...args);
//         if (result === false)
//           return false;
//         //todo do we want the output of the function to be the thing that the next function works with?
//         // This kind of filtering from the functions. It would map with the .chain(..).ing(..).monad(..).thing.
//         // The monad would return the same object. This is not what this chaining function does.
//         // There is clarity in having fixed arguments. You don't need to worry too much about what comes before or after.
//         // but if we don't do the before and after, then we can have a situation of lots of mutations, and that leads to confusion and errors down the line.
//       } catch (err) {
//         //todo dispatch an async error the same as you get when you get an error from an async function.
//         return false;
//       }
//     }
//   }
// }