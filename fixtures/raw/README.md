Drop real provider exports here, exactly as downloaded — original filenames,
nothing edited, one folder per provider if that is easier.

This directory is gitignored. Nothing in it is committed, and nothing in it is
ever sent to a model or written into the database. It exists so report contracts
can be built against real column names instead of guesses.

The scrubbed, committable fixtures derived from these files go in
fixtures/providers/.
