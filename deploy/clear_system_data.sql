-- Clear system master data before importing deploy/system_data.sql.
-- Use only for a new test database, or when existing test system master data can be replaced.
-- This does not migrate business data such as projects, requirements, tasks, defects, versions, or documents.

SET FOREIGN_KEY_CHECKS=0;

DELETE FROM `Account`;
DELETE FROM `PersonPosition`;
DELETE FROM `Person`;
DELETE FROM `Organization`;
DELETE FROM `Position`;
DELETE FROM `Dictionary`;
DELETE FROM `RequirementPriority`;
DELETE FROM `DefectPriority`;
DELETE FROM `BoardRuleConfig`;

ALTER TABLE `Account` AUTO_INCREMENT = 1;
ALTER TABLE `PersonPosition` AUTO_INCREMENT = 1;
ALTER TABLE `Person` AUTO_INCREMENT = 1;
ALTER TABLE `Organization` AUTO_INCREMENT = 1;
ALTER TABLE `Position` AUTO_INCREMENT = 1;
ALTER TABLE `Dictionary` AUTO_INCREMENT = 1;
ALTER TABLE `RequirementPriority` AUTO_INCREMENT = 1;
ALTER TABLE `DefectPriority` AUTO_INCREMENT = 1;
ALTER TABLE `BoardRuleConfig` AUTO_INCREMENT = 1;

SET FOREIGN_KEY_CHECKS=1;
