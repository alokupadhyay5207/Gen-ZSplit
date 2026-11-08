/**
 * A problem the *user* can fix. The message is written to be shown verbatim.
 *
 * Anything that is NOT a GroupError is a bug or an infrastructure failure: it is
 * logged with a stack trace and the user sees a generic message instead.
 */
export class GroupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupError";
  }
}

export class MoneyError extends GroupError {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}
