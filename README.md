# customAttributes2

New version of the customAttribute project

## Syntax

> `click:one:two::alpha:beta`

A custom attribute is added as any other attribute to an element. The customAttribute consists of three main parts:
1. event (`click`)
2. ...filterFunctions (`one:two`)
3. ...defaultAction functions (`alpha:beta`)

The event is either a native event (such as `click`), or a custom event that triggers a new event. Custom events are declared using `customAttributes.declare("type", DefinitionClass);` 

The filterFunctions and defaultAction are the same type of functions. If a set of defaultAction functions are declared, then  essentially the same, a set of functions declared using `customReactions.define("prefix", DefinitionFunction);`.

//Syntax:
// normal sync reaction: "click:log:bob"
// normal sync reaction+default action: (filter1:filter2) with default action(log:open): "click:filter1:filter2::log:open:"


```html
 <h1 click:filterA_one_two>
 <script>
 customReactions.define("filterA", function filter(e, prefix, one, two){
      prefix==="filterA"
      one === "one"
      two === "two"
      ...
    });
 </script>
```