ALTER TABLE `Project`
  MODIFY `stage` ENUM('INITIATED', 'RESEARCHING', 'SOLUTION_DESIGN', 'DEV_TEST', 'IN_PROGRESS', 'ONLINE_OPS', 'CLOSED') NOT NULL DEFAULT 'INITIATED';

UPDATE `Project`
SET `stage` = 'IN_PROGRESS'
WHERE `stage` IN ('RESEARCHING', 'SOLUTION_DESIGN', 'DEV_TEST');

ALTER TABLE `Project`
  MODIFY `stage` ENUM('INITIATED', 'IN_PROGRESS', 'ONLINE_OPS', 'CLOSED') NOT NULL DEFAULT 'INITIATED';

UPDATE `Dictionary`
SET `isActive` = false
WHERE `type` = 'PROJECT_STAGE'
  AND `code` IN ('RESEARCHING', 'SOLUTION_DESIGN', 'DEV_TEST');

INSERT INTO `Dictionary` (`type`, `code`, `name`, `isSystem`, `isActive`, `sort`, `createdAt`, `updatedAt`)
VALUES ('PROJECT_STAGE', 'IN_PROGRESS', '进行中', true, true, 2, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `isSystem` = true,
  `isActive` = true,
  `sort` = VALUES(`sort`),
  `updatedAt` = NOW(3);

UPDATE `Dictionary`
SET `sort` = CASE `code`
  WHEN 'INITIATED' THEN 1
  WHEN 'IN_PROGRESS' THEN 2
  WHEN 'ONLINE_OPS' THEN 3
  WHEN 'CLOSED' THEN 4
  ELSE `sort`
END
WHERE `type` = 'PROJECT_STAGE'
  AND `code` IN ('INITIATED', 'IN_PROGRESS', 'ONLINE_OPS', 'CLOSED');
