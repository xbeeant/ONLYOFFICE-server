-- You must be logged in as SYS(sysdba) user.
-- Here, "onlyoffice" is a PBD(service) name.
alter session set container = onlyoffice;

DROP TABLE onlyoffice.doc_changes CASCADE CONSTRAINTS PURGE;
DROP TABLE onlyoffice.task_result CASCADE CONSTRAINTS PURGE;