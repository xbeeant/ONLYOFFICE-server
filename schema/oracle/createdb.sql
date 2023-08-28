-- You must be logged in as SYS(sysdba) user.
-- Here, "onlyoffice" is a PBD(service) name.
alter session set container = xepdb1;

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
    CONSTRAINT doc_changes_unique UNIQUE (tenant, id, change_id),
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
    created_at TIMESTAMP DEFAULT SYSDATE NOT NULL,
    last_open_date TIMESTAMP NOT NULL,
    user_index NUMBER DEFAULT 1 NOT NULL,
    change_id NUMBER DEFAULT 0 NOT NULL,
    callback NVARCHAR2(2000),  -- codebase uses '' as default values here, but Oracle treat '' as NULL, so NULL permitted for this value.
    baseurl NVARCHAR2(2000),  -- codebase uses '' as default values here, but Oracle treat '' as NULL, so NULL permitted for this value.
    password NVARCHAR2(2000) NULL,
    additional NVARCHAR2(2000) NULL,
    CONSTRAINT task_result_unique UNIQUE (tenant, id),
    CONSTRAINT task_result_unsigned_int CHECK (user_index BETWEEN 0 AND 4294967295 AND change_id BETWEEN 0 AND 4294967295)
);
