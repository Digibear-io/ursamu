import mu, { db, payload, flags, attrs, parser } from "../mu";
import { DBObj, MuRequest } from "../types";
import { Client } from "socket.io";
import Nameformat from "./@nameformat";

export interface LookData {
  [index: string]: any;
  en: DBObj | undefined;
  tar: DBObj | undefined;
  thing: DBObj[] | undefined;
  player: DBObj[] | undefined;
  exit: DBObj[] | undefined;
}

export default () => {
  mu.cmd({
    name: "Look",
    pattern: /l(?:\s+?(\w+))?$|^look(?:\s+?(\w+))?$/i,
    flags: "connected",
    exec: async (req: MuRequest, args: string[]) => {
      /**
       * Check to see if the enactor can see the target
       * @param en Enactor DBObj
       * @param tar Target DBObj
       */

      const look: LookData = {
        en: undefined,
        tar: undefined,
        player: [],
        thing: [],
        exit: [],
      };

      const description = "";
      // TODO:  Move this to grid.ts
      const canSee = (en: DBObj, tar: DBObj) => {
        if (flags.hasFlags(tar, "dark")) {
          if (
            (flags.canEdit(en, tar) || tar.owner === en._id) &&
            (en.location === tar.location ||
              en.location === tar._id ||
              tar.location === en._id)
          ) {
            return true;
          } else {
            return false;
          }
        } else if (
          en.location === tar.location ||
          en.location === tar._id ||
          tar.location === en._id
        ) {
          return true;
        } else {
          return false;
        }
      };

      const en = mu.connections.get(req.socket.id);
      const tar = await db.target(en!, args[1]);

      // Promisify Socket.io's clients by room listing.
      const clients = (room: string): Promise<string[]> =>
        new Promise((resolve: any, reject: any) =>
          mu.io?.to(room).clients((err: Error, clients: string[]) => {
            if (err) reject(err);
            resolve(clients);
          })
        );

      if (tar) {
        if (canSee(en!, tar)) {
          // Either use the object's name, or name format depending
          // on if it exists, and the looker is within the target.
          const namefmt = attrs.get(en!, tar, "nameformat");
          let name = db.name(en!, tar);

          // if the enactor is within the target, use the @nameformat
          // value for display.
          if (namefmt && en!.location === tar._id) {
            let tempName = namefmt.value.replace(/%0/g, name);
            name = parser.parse(en!, tempName);
          }

          // Either use the object's contents, or  conformat depending
          // on if it exists, and the looker is within the target.
          const confmt = attrs.get(en!, tar, "conformat");

          // players if the object has any.
          const players = (await clients(tar._id!))
            .map((client) => mu.connections.get(client) as DBObj)
            .map((obj) => (canSee(en!, obj) ? db.name(en!, obj) : false))
            .filter(Boolean);

          const IDs = (await clients(tar._id!))
            .map((client) => mu.connections.get(client) as DBObj)
            .map((obj) => (canSee(en!, obj) ? obj._id : false))
            .filter(Boolean)
            .join(" ");

          let contents = "\n\n";

          // if target is a room, get it's players.
          if (tar.type === "room") {
            if (players.length > 0) {
              contents += "Contents:\n" + players.join("\n");
            }
          }

          // format exits
          const exitList = [];
          let exits = "";
          if (tar.exits) {
            // Go through and get the DBObj of each exit.
            for (const exit of tar.exits) {
              exitList.push((await db.get({ _id: exit })) as DBObj);
            }

            if (exitList.length > 0) {
              exits += `\n\nExits:\n${exitList
                .map((exit) =>
                  parser.colorSub(db.name(en!, exit).split(";")[0])
                )
                .join(" ")}`;
            }
          }

          // Substitute out color code for html markup.
          contents = parser.colorSub(contents);
          const desc =
            attrs.get(en!, tar, "description")?.value ||
            "You see nothing special.";

          return payload(req, {
            command: "desc",
            message: `${name}\n${desc}\n${contents}${exits}`,
            data: { en, tar: en, look },
          });
        } else {
          return {
            socket: req.socket,
            payload: {
              command: "command",
              message: "I don't see that here.",
              data: req.payload.data,
            },
          };
        }
      } else {
        return payload(req, {
          command: "command",
          message: "I don't see that here.",
        });
      }
    },
  });
};
