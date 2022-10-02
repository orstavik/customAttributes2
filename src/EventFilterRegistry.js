/**
 <h1 click:filterA_one_two>
 <script>
 customEventFilters.define("filterA", function filter(e, prefix, one, two){
      prefix==="filterA"
      one === "one"
      two === "two"
      ...
    });
 </script>
 */

class EventFilterRegistry {
  define(prefix, Function) {
    if (/^(async |)(\(|[^([]+=)/.test(Function.toString()))
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
      return {Definition: this[name], prefix: name, suffix: []};
    const prefix = Object.keys(this).find(prefix => name.startsWith(prefix))
    if (!prefix)
      return;
    let suffix = name.substring(prefix.length);
    suffix = suffix[0] === '_' ? suffix.substring(1).split("_") : [suffix];
    return {Definition: this[prefix], prefix, suffix};
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
}

window.customEventFilters = new EventFilterRegistry();