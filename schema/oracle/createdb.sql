-- You must be logged in as SYS(sysdba) user.
-- Here, "onlyoffice" is a PBD(service) name.
alter session set container = onlyoffice;

-- In tables creation section "onlyoffice" is a user name.
-- ----------------------------
-- Table structure for doc_changes
-- ----------------------------

CREATE TABLE onlyoffice.doc_changes (
    tenant NVARCHAR2(255) NOT NULL,
    id NVARCHAR2(255) NOT NULL,
    change_id NUMBER NOT NULL,
    user_id NVARCHAR2(255) NOT NULL,
    user_id_original NVARCHAR2(255) NOT NULL,
    user_name NVARCHAR2(255) NOT NULL,
    change_data NCLOB NOT NULL,
    change_date TIMESTAMP NOT NULL,
    CONSTRAINT doc_changes_unsigned_int CHECK (change_id between 0 and 4294967295)
);

-- ----------------------------
-- Table structure for task_result
-- ----------------------------

CREATE TABLE onlyoffice.task_result (
    tenant NVARCHAR2(255) NOT NULL,
    id NVARCHAR2(255) NOT NULL,
    status NUMBER NOT NULL,
    status_info NUMBER NOT NULL,
    created_at TIMESTAMP DEFAULT SYSDATE, -- check format
    last_open_date TIMESTAMP NOT NULL,
    user_index NUMBER DEFAULT 1 NOT NULL,
    change_id NUMBER DEFAULT 0 NOT NULL,
    callback NCLOB NOT NULL,
    baseurl NCLOB NOT NULL,
    password NCLOB NULL,
    additional NCLOB NULL,
    CONSTRAINT task_result_unsigned_int CHECK (user_index BETWEEN 0 AND 4294967295 AND change_id BETWEEN 0 AND 4294967295)
);
