class GroupError(Exception):
    """A problem the *user* can fix. The message is written to be flashed verbatim.

    Anything that is NOT a GroupError is a bug or an infrastructure failure: it
    is logged with a traceback and the user sees a generic message instead.
    """
