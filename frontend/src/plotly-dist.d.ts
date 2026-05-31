// plotly.js-dist-min ships the same runtime API as plotly.js but has no own
// types. Borrow @types/plotly.js for it.
declare module "plotly.js-dist-min" {
  import Plotly from "plotly.js";
  export = Plotly;
}
