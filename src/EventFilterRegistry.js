// /**
//  <h1 click:filterA_one_two>
//  <script>
//  customEventFilters.define("filterA", function filter(e, prefix, one, two){
//       prefix==="filterA"
//       one === "one"
//       two === "two"
//       ...
//     });
//  </script>
//  */
//
// class EventFilterRegistry {
//   define(prefix, Function) {
//     if (/^(async |)(\(|[^([]+=)/.test(Function.toString()))
//       throw `Arrow functions cannot be bound as customEventFilters.`;
//     const usedFilterName = Object.keys(this).find(name => this[name] === Function);
//     if (usedFilterName === prefix)
//       return console.warn(`Defining the event filter "${prefix}" multiple times.`);
//     if (usedFilterName)
//       throw `Function: "${Function.name}" is already defined as event filter "${usedFilterName}".`;
//     const overlapDefinition = Object.keys(this).find(old => prefix.startsWith(old) || old.startsWith(prefix));
//     if (overlapDefinition)
//       throw `The eventFilter prefix: "${prefix}" is already defined as "${overlapDefinition}".`;
//     this[prefix] = Function;
//   }
//
//   getFilterFunctions(filters) {
//     const res = [];
//     for (let [prefix, ...suffix] of filters) {
//       if (!this[prefix])
//         return [];
//       res.push({Definition: this[prefix], prefix, suffix});
//     }
//     return res;
//   }
// }
//
// window.customEventFilters = new EventFilterRegistry();