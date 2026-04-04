CREATE SCHEMA IF NOT EXISTS football_pool;

CREATE TABLE "football_pool"."users" (
  "id" integer PRIMARY KEY,
  "first_name" varchar,
  "last_name" varchar,
  "email" varchar,
  "phone" varchar,
  "created_at" timestamp,
  "is_player_flg" boolean DEFAULT false
);

CREATE TABLE "football_pool"."team" (
  "id" integer PRIMARY KEY,
  "team_name" varchar,
  "primary_color" varchar,
  "secondary_color" varchar,
  "logo_file" varchar,
  "primary_contact_id" integer,
  "secondary_contact_id" integer,
  "created_at" timestamp
);

CREATE TABLE "football_pool"."player_team" (
  "id" integer PRIMARY KEY,
  "user_id" integer NOT NULL,
  "team_id" integer NOT NULL,
  "jersey_num" int,
  "created_at" timestamp,
  UNIQUE ("user_id", "team_id")
);

CREATE TABLE "football_pool"."pool" (
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

CREATE TABLE "football_pool"."square" (
  "id" integer PRIMARY KEY,
  "pool_id" int,
  "square_num" int,
  "participant_id" int,
  "player_id" int,
  "paid_flg" boolean
);

CREATE TABLE "football_pool"."game" (
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

CREATE TABLE "football_pool"."game_square_numbers" (
  "id" integer PRIMARY KEY,
  "game_id" integer,
  "square_id" integer,
  "row_digit" integer,
  "col_digit" integer
);

CREATE TABLE "football_pool"."winnings_ledger" (
  "id" integer PRIMARY KEY,
  "game_id" integer,
  "pool_id" integer,
  "quarter" integer,
  "winner_user_id" integer,
  "amount_won" integer,
  "payout_status" varchar
);

ALTER TABLE "football_pool"."team" ADD FOREIGN KEY ("primary_contact_id") REFERENCES "football_pool"."users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."team" ADD FOREIGN KEY ("secondary_contact_id") REFERENCES "football_pool"."users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."player_team" ADD FOREIGN KEY ("user_id") REFERENCES "football_pool"."users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."player_team" ADD FOREIGN KEY ("team_id") REFERENCES "football_pool"."team" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."pool" ADD FOREIGN KEY ("team_id") REFERENCES "football_pool"."team" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."square" ADD FOREIGN KEY ("pool_id") REFERENCES "football_pool"."pool" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."square" ADD FOREIGN KEY ("participant_id") REFERENCES "football_pool"."users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."square" ADD FOREIGN KEY ("player_id") REFERENCES "football_pool"."player_team" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."game" ADD FOREIGN KEY ("pool_id") REFERENCES "football_pool"."pool" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."game_square_numbers" ADD FOREIGN KEY ("game_id") REFERENCES "football_pool"."game" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."game_square_numbers" ADD FOREIGN KEY ("square_id") REFERENCES "football_pool"."square" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."winnings_ledger" ADD FOREIGN KEY ("game_id") REFERENCES "football_pool"."game" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."winnings_ledger" ADD FOREIGN KEY ("pool_id") REFERENCES "football_pool"."pool" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "football_pool"."winnings_ledger" ADD FOREIGN KEY ("winner_user_id") REFERENCES "football_pool"."users" ("id") DEFERRABLE INITIALLY IMMEDIATE;
