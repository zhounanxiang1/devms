ALTER TABLE `Defect`
  ADD COLUMN `plannedStartDate` DATETIME(3) NULL AFTER `attachmentUrl`,
  ADD COLUMN `plannedFinishDate` DATETIME(3) NULL AFTER `plannedStartDate`;

UPDATE `Defect`
SET
  `plannedStartDate` = COALESCE(`plannedStartDate`, `plannedFixDate`),
  `plannedFinishDate` = COALESCE(`plannedFinishDate`, `plannedFixDate`)
WHERE `plannedFixDate` IS NOT NULL;
