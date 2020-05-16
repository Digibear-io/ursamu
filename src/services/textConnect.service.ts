import { MuRequest } from "../types";
import mu, { payload } from "../mu";

const textConnect = async (req: MuRequest) => {
  return payload(req, {
    message: mu.text.get("connect"),
    data: { matched: true },
  });
};

export default mu.service("textconnect", textConnect);