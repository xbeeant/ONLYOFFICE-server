USE onlyoffice;

CREATE TABLE doc_changes(
    tenant NVARCHAR(255) NOT NULL,
    id NVARCHAR(255) NOT NULL,
    change_id DECIMAL NOT NULL CONSTRAINT unsigned_doc_changes CHECK(change_id BETWEEN 0 AND 4294967295),
    user_id NVARCHAR(255) NOT NULL,
    user_id_original NVARCHAR(255) NOT NULL,
    user_name NVARCHAR(255) NOT NULL,
    change_data NVARCHAR(MAX) NOT NULL,
    change_date DATETIME2(6) NOT NULL,
    UNIQUE (tenant, id, change_id)
);

CREATE TABLE task_result (
    tenant NVARCHAR(255) NOT NULL,
    id NVARCHAR(255) NOT NULL,
    status SMALLINT NOT NULL,
    status_info INT NOT NULL,
    created_at DATETIME2(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_open_date DATETIME2(6) NOT NULL,
    user_index DECIMAL DEFAULT 1 NOT NULL,
    change_id DECIMAL DEFAULT 0 NOT NULL,
    callback NVARCHAR(MAX) NOT NULL,
    baseurl NVARCHAR(MAX) NOT NULL,
    password NVARCHAR(MAX) NULL,
    additional NVARCHAR(MAX) NULL,
    UNIQUE (tenant, id),
    CONSTRAINT unsigned_task_result CHECK(change_id BETWEEN 0 AND 4294967295 AND user_index BETWEEN 0 AND 4294967295)
);