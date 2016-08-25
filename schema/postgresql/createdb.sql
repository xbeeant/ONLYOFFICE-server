--
-- Create schema onlyoffice
--

-- CREATE DATABASE onlyoffice ENCODING = 'UTF8' CONNECTION LIMIT = -1;

--
-- Drop tables
--
DROP TABLE IF EXISTS "public"."doc_callbacks";
DROP TABLE IF EXISTS "public"."doc_changes";

-- ----------------------------
-- Table structure for doc_callbacks
-- ----------------------------
CREATE TABLE IF NOT EXISTS "public"."doc_callbacks" (
"id" varchar(255) COLLATE "default" NOT NULL,
"callback" text COLLATE "default" NOT NULL,
"baseurl" text COLLATE "default" NOT NULL,
PRIMARY KEY ("id")
)
WITH (OIDS=FALSE);

-- ----------------------------
-- Table structure for doc_changes
-- ----------------------------
CREATE TABLE IF NOT EXISTS "public"."doc_changes" (
"id" varchar(255) COLLATE "default" NOT NULL,
"change_id" int8 NOT NULL,
"user_id" varchar(255) COLLATE "default" NOT NULL,
"user_id_original" varchar(255) COLLATE "default" NOT NULL,
"user_name" varchar(255) COLLATE "default" NOT NULL,
"change_data" text COLLATE "default" NOT NULL,
"change_date" timestamp without time zone NOT NULL,
PRIMARY KEY ("id", "change_id")
)
WITH (OIDS=FALSE);

-- ----------------------------
-- Table structure for task_result
-- ----------------------------
CREATE TABLE IF NOT EXISTS "public"."task_result" (
"id" varchar(255) COLLATE "default" NOT NULL,
"status" int2 NOT NULL,
"status_info" int8 NOT NULL,
"last_open_date" timestamp without time zone NOT NULL,
"title" varchar(255) COLLATE "default" NOT NULL,
"user_index" int8 NOT NULL DEFAULT 1,
"change_id" int8 NOT NULL DEFAULT 0,
PRIMARY KEY ("id")
)
WITH (OIDS=FALSE);