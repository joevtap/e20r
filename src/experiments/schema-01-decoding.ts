import { Schema } from "effect";

const User = Schema.Struct({
  name: Schema.String,
  age: Schema.Finite,
});

type User = typeof User.Type;

const decodeUser = Schema.decodeUnknownSync(User);

const input: unknown = {
  name: "Ada",
  age: 36,
};

const user: User = decodeUser(input);

console.log(user);

/**
 * Exercises:
 *
 * 1. Change `age` to the string `"36"`. Predict the result, then run it.
 * 2. Add `active: Schema.Boolean` to `User`.
 * 3. Decode an object with `active: true`.
 * 4. Try omitting `active` entirely.
 * 5. Try passing `active: "yes"`.
 *
 * Notice how a missing property and a property with the wrong type are
 * reported differently.
 */
