import { types } from "util";
import { loadDir } from "../utils";
import { MuRequest } from "../types";

type Exec = (req: MuRequest, args: string[]) => Promise<MuRequest>;
export type Cmd = {
  name: string;
  flags?: string;
  pattern: RegExp | string;
  exec: Exec;
};
export class MuCommand {
  private _pattern: RegExp | string;
  flags: string;
  name: string;
  exec: Exec;

  constructor({
    name,
    flags,
    pattern,
    exec,
  }: {
    name: string;
    flags?: string;
    pattern: RegExp | string;
    exec: Exec;
  }) {
    this.name = name;
    this._pattern = pattern;
    this.flags = flags || "";
    this.exec = exec;
  }

  /**
   * Getter for the pattern.  Always return a regex string.
   */
  get pattern() {
    return types.isRegExp(this._pattern)
      ? this._pattern
      : this._globStringToRegex(this._pattern);
  }

  /**
   *  Set the pattern.
   */
  set pattern(str: string | RegExp) {
    this._pattern = str;
  }

  /**
   * Convert a wildcard(glob) string to a regular expression.
   * @param str The string to convert to regex.
   */
  private _globStringToRegex(str: string) {
    return new RegExp(
      this._preg_quote(str)
        .replace(/\\\*/g, "(.*)")
        .replace(/\\\?/g, "(.)")
        .replace(" ", "\\s"),
      "i"
    );
  }

  /**
   * Escape a string of characracters to be Regex escaped.
   * @param str The string to convert to a regex statement.
   * @param delimiter The character to seperate out words in
   * the string.
   */
  private _preg_quote(str: string, delimiter?: string) {
    // http://kevin.vanzonneveld.net
    // +   original by: booeyOH
    // +   improved by: Ates Goral (http://magnetiq.com)
    // +   improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
    // +   bugfixed by: Onno Marsman
    // +   improved by: Brett Zamir (http://brett-zamir.me)
    // *     example 1: preg_quote("$40");
    // *     returns 1: '\$40'
    // *     example 2: preg_quote("*RRRING* Hello?");
    // *     returns 2: '\*RRRING\* Hello\?'
    // *     example 3: preg_quote("\\.+*?[^]$(){}=!<>|:");
    // *     returns 3: '\\\.\+\*\?\[\^\]\$\(\)\{\}\=\!\<\>\|\:'
    return (str + "").replace(
      new RegExp(
        "[.\\\\+*?\\[\\^\\]$(){}=!<>|:\\" + (delimiter || "") + "-]",
        "g"
      ),
      "\\$&"
    );
  }
}

export class Commands {
  cmds: MuCommand[];
  private static instance: Commands;

  private constructor() {
    this.cmds = [];
    this.init();
  }

  /**
   * Instantiate the object.
   */
  init() {
    console.log("Loading Commands...");
    loadDir("./commands/", (name: string, loaded: Boolean) => {
      if (!loaded) console.log(`Command failed to loaded: ${name}`);
    });
  }

  /**
   * Add a new command to the system.
   * @param command The command object to be added to the system
   */
  add({
    name,
    flags,
    pattern,
    exec,
  }: {
    name: string;
    flags?: string;
    pattern: RegExp | string;
    exec: Exec;
  }) {
    const command = new MuCommand({ name, flags, pattern, exec });
    this.cmds.push(command);
  }

  /**
   * Match a string to a command pattern.
   * @param str The string to match the command against.
   */
  match(str: string) {
    return this.cmds
      .map((cmd) => {
        const matched = str.match(cmd.pattern);
        if (matched) {
          return {
            args: matched,
            exec: cmd.exec,
            flags: cmd.flags,
          };
        } else {
          return;
        }
      })
      .filter(Boolean)[0];
  }

  async force(req: MuRequest, name: string, args: string[] = []) {
    return await this.cmds
      .filter((cmd) => cmd.name.toLowerCase() === name.toLowerCase())[0]
      .exec(req, args);
  }

  static getInstance() {
    if (!Commands.instance) Commands.instance = new Commands();
    return Commands.instance;
  }
}

export default Commands.getInstance();
