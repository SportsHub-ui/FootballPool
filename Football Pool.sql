CREATE TABLE "users" (
  "id" integer PRIMARY KEY,
  "first_name" varchar,
  "last_name" varchar,
  "email" varchar,
  "phone" varchar,
  "created_at" timestamp
);

CREATE TABLE "team" (
  "id" integer PRIMARY KEY,
  "team_name" varchar,
  "primary_color" varchar,
  "secondary_color" varchar,
  "logo_file" varchar,
  "primary_contact_id" integer,
  "secondary_contact_id" integer,
  "created_at" timestamp
);

CREATE TABLE "player" (
  "id" integer PRIMARY KEY,
  "team_id" integer,
  "user_id" integer,
  "jersey_num" int
);

CREATE TABLE "pool" (
  "id" integer PRIMARY KEY,
  "pool_name" varchar,
  "team_id" integer,
  "season" integer,
  "primary_team" varchar,
  "square_cost" integer,
  "q1_payout" integer,
  "q2_payout" integer,
  "q3_payout" integer,
  "q4_payout" integer,
  "created_at" timestamp
);

CREATE TABLE "square" (
  "id" integer PRIMARY KEY,
  "pool_id" int,
  "square_num" int,
  "participant_id" int,
  "player_id" int,
  "paid_flg" boolean
);

CREATE TABLE "game" (
  "id" integer PRIMARY KEY,
  "is_simulation" boolean,
  "opponent" varchar,
  "game_dt" date,
  "pool_id" int,
  "q1_primary_score" int,
  "q2_primary_score" int,
  "q3_primary_score" int,
  "q4_primary_score" int,
  "q1_opponent_score" int,
  "q2_opponent_score" int,
  "q3_opponent_score" int,
  "q4_opponent_score" int
);

CREATE TABLE "game_square_numbers" (
  "id" integer PRIMARY KEY,
  "game_id" integer,
  "square_id" integer,
  "row_digit" integer,
  "col_digit" integer
);

CREATE TABLE "winnings_ledger" (
  "id" integer PRIMARY KEY,
  "game_id" integer,
  "pool_id" integer,
  "quarter" integer,
  "winner_user_id" integer,
  "amount_won" integer,
  "payout_status" varchar
);

ALTER TABLE "team" ADD FOREIGN KEY ("primary_contact_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "team" ADD FOREIGN KEY ("secondary_contact_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "player" ADD FOREIGN KEY ("team_id") REFERENCES "team" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "player" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "pool" ADD FOREIGN KEY ("team_id") REFERENCES "team" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "square" ADD FOREIGN KEY ("pool_id") REFERENCES "pool" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "square" ADD FOREIGN KEY ("participant_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "square" ADD FOREIGN KEY ("player_id") REFERENCES "player" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "game" ADD FOREIGN KEY ("pool_id") REFERENCES "pool" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "game_square_numbers" ADD FOREIGN KEY ("game_id") REFERENCES "game" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "game_square_numbers" ADD FOREIGN KEY ("square_id") REFERENCES "square" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "winnings_ledger" ADD FOREIGN KEY ("game_id") REFERENCES "game" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "winnings_ledger" ADD FOREIGN KEY ("pool_id") REFERENCES "pool" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "winnings_ledger" ADD FOREIGN KEY ("winner_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;
