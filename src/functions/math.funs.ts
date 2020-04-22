import parser, { Expression, Scope } from "../api/parser";
import { DBObj } from "../api/database";

export default () => {
  // MATHS!

  /**
   * Add a list of numbers together!
   */
  parser.add("add", async (en: DBObj, args: string[], scope: Scope) => {
    let total = 0;
    return args
      .map((arg) => parseInt(arg, 10))
      .reduce((p: number, c: number) => (p += c), 0).toString();
  });
};
