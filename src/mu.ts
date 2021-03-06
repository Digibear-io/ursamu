import io, { Server as IOServer, Socket } from "socket.io";
import { Server as HTTPServer, Server } from "http";
import { EventEmitter } from "events";
import db, { dbref } from "./api/database";
import parser from "./api/parser";
import md from "./api/md";
import cmds, { Cmd } from "./api/commands";
import config from "./api/config";
import flags from "./api/flags";
import attrs from "./api/attributes";
import services from "./api/services";
import help from "./api/helpsys";
import express from "express";
import cors from "cors";
import bearerToken from "express-bearer-token";
import {
  DBObj,
  MuFunction,
  MuService,
  Message,
  MuRequest,
  Plugin,
} from "./types";
import { loadDir, loadText } from "./utils";
import { Application } from "express";
import authenticate from "./middleware/authenticate";
import apiRoute from "./routes/api.route";
import apiLogin from "./routes/login.route";

/**
 * The main MU class.
 * This class is responsible for gluing the different individual
 * pieces of Ursamu into a workable facade.
 */
export class MU extends EventEmitter {
  io: IOServer | undefined;
  private _http: HTTPServer | undefined;
  private static instance: MU;
  connections: Map<string, DBObj>;
  private _plugins: Plugin[];
  text: Map<string, string>;

  private constructor() {
    super();
    this.io;
    this._http;
    this.connections = new Map();
    this._plugins = [];
    this.text = new Map();
  }

  /**
   * Get a (new)instance of the MU Class.
   */
  static getInstance() {
    if (!this.instance) {
      MU.instance = new MU();
    }

    return MU.instance;
  }

  /**
   * Get a SocketID from a DBOBj _id if it exists in the
   * connection map.
   * @param id The database ID for the target.
   */
  socketID(id: string) {
    let socketID = "";

    this.connections.forEach((v, k) => {
      if (v._id === id) socketID = k;
    });

    return socketID;
  }

  /**
   * Load a module when the server starts.  A good place
   * to load code that needs to run an independant setup,
   * or instantiate multiple game functions at startup.
   * @param plugin The file to load at startup.
   */
  register(plugin: Plugin) {
    this._plugins.push(plugin);
  }

  /**
   * Add an in-game command to the system.
   * @param cmd Facade for adding new commands to the
   * mu server.
   */
  cmd(cmd: Cmd) {
    cmds.add(cmd);
  }

  /**
   * Add a new service to the system.
   * @param name The name of the service
   * @param service The service to be added to the system
   */
  service(name: string, service?: MuService) {
    if (service) return services.register(name, service);
    return services.get(name);
  }

  /**
   * Send a message depending on the enactor and target fields.
   * @param res The response from the MU to be sent back to
   * a potential list of targets.
   */
  send(res: MuRequest) {
    // Render markdown & a
    res.payload.message = md.render(
      res.payload.message ? res.payload.message : ""
    );

    // If the request doesn't have an enactor attached, try to get
    // the character information from the socket if it exists.
    if (this.connections.has(res.socket.id) && !res.payload.data.en) {
      res.payload.data.en = this.connections.get(res.socket.id);
    }

    // if the request type isn't a message, and there's no target set,
    // the target should be the enactor.
    if (
      res.payload.command.toLowerCase() !== "message" &&
      !res.payload.data.tar
    ) {
      res.payload.data.tar = res.payload.data.en;
    }

    // If the response has a target, send Send the message depending on
    // the target type. else, send it the response to the enactor's location
    // by default for general chat like behavior.
    if (res.payload.data.tar) {
      // If it's a player, send it to their socket ID.
      if (res.payload.data.tar.type === "player") {
        this.io?.to(this.socketID(res.payload.data.tar._id!)).send(res.payload);
      } else if (res.payload.data.tar.type === "room") {
        // Else if it's a room, just send to it's id.

        this.io?.to(res.payload.data.tar._id!).send(res.payload);
      }
    } else {
      if (res.payload.data.en) {
        this.io?.to(res.payload.data.en.location).send(res.payload);
      } else {
        // Just send to the socket.
        this.io?.to(res.socket.id).send(res.payload);
      }
    }
  }

  attach(server: Server) {
    this._http = server;
    this.start();
  }

  /**
   * Start the game engine.
   */
  private async start() {
    // Handle client connections.
    console.log("UrsaMU Booting...");
    this.io = io(this._http);

    this.io?.on("connection", async (socket: Socket) => {
      // Whenever a socket sends a message, process it, and
      // return the results.
      socket.on("message", async (message: Message) => {
        const payload: Message = message;
        const res = await parser.process({ socket, payload });

        // If the request was matched in the pipeline, send a response.
        // else if no match, send 'huh' message, if socket is logged in.
        // nothing for unverifified sockets!
        if (res.payload.data.matched) {
          this.send(res);
        } else if (this.connections.has(res.socket.id)) {
          const en = this.connections.get(res.socket.id);
          res.payload.message = "Huh? Type '**help**' for help.";
          this.send({
            socket,
            payload: {
              command: res.payload.command,
              message: res.payload.message,
              data: {
                en,
              },
            },
          });
        } else {
          res.payload.message = "";
          this.send(res);
        }
      });

      // When a socket disconnects rem ove the connected
      // flag from the character object.
      socket.on("disconnect", async () => {
        if (this.connections.has(socket.id)) {
          const player = this.connections.get(socket.id);
          if (player) {
            await flags.setFlag(player, "!connected");

            // If the player isn't dark, send a disconnect message to the
            // room.
            if (!flags.hasFlags(player, "dark")) {
              const room = await db.get({ _id: player.location });
              if (room) {
                this.send({
                  socket,
                  payload: {
                    command: "message",
                    message: `${player.name} has disconnected`,
                    data: {
                      en: player,
                    },
                  },
                });
              }
            }
          }
        }
      });

      // When there's an error with the socket, remove
      // the connected tag, and boot them from the connected list.

      socket.on("error", async () => {
        if (this.connections.has(socket.id)) {
          const player = this.connections.get(socket.id);
          if (player) {
            await flags.setFlag(player, "!connected");
          }
        }
      });
    });

    // Load the default middleware.
    loadDir("./services");
    loadText("../text");

    // Run plugins.
    for await (const plugin of this._plugins) {
      plugin(this);
    }

    // Test for starting room.  If one doesn't exist, create it!
    const limbo = await db.find({ type: "room" });
    // No rooms exist, dig limbo!
    if (limbo.length <= 0) {
      const created = db.create({
        name: config.game.startingRoom || "Limbo",
        dbref: await dbref(),
        type: "room",
        attributes: [],
        flags: [],
        contents: [],
        exits: [],
        location: config.game.startingRoom || "Limbo",
      });
      if (created)
        console.log(
          "Room " + (config.game.startingRoom || "Limbo") + " - Created."
        );
    }

    console.log("Startup Complete.");
    this.emit("started");
  }
}

export interface Payload {
  command?: string;
  message?: string;
  data?: { [key: string]: any };
}

/**
 * Helper function for creating new return data.
 * @param req The request object given to the command
 * @param payload The different payload fields available.
 */
export const payload = (req: MuRequest, payload?: Payload): MuRequest => {
  return {
    socket: req.socket,
    payload: {
      command: payload?.command || req.payload.command,
      message: payload?.message || req.payload.message,
      data: { ...req.payload.data, ...payload?.data },
    },
  };
};

export default MU.getInstance();
export { cmds, db, parser, flags, config, attrs, dbref, help };
