/**
 * Labeled message is a general structure
 * used by all coordinated messages between
 * host, client, and background clients.
 *
 * The msgType will indicate the nature of
 * the message. The msg will contain the
 * information desired to be communicated.
 */
export interface LabeledMsg {
  msgType: string;
  msg: any;
}
