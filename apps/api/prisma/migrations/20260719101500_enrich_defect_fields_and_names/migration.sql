ALTER TABLE `Defect`
  ADD COLUMN `foundAt` DATETIME(3) NULL,
  ADD COLUMN `entryPoint` VARCHAR(191) NULL,
  ADD COLUMN `impactScope` TEXT NULL,
  ADD COLUMN `precondition` TEXT NULL,
  ADD COLUMN `deviceInfo` TEXT NULL,
  ADD COLUMN `testData` TEXT NULL;

UPDATE `DefectPriority`
SET `name` = CASE `code`
  WHEN 'L1' THEN '阻塞'
  WHEN 'L2' THEN '严重'
  WHEN 'L3' THEN '一般'
  WHEN 'L4' THEN '次要'
  ELSE `name`
END,
`description` = CASE `code`
  WHEN 'L1' THEN '核心流程无法继续、系统不可用、资损或高危安全问题'
  WHEN 'L2' THEN '核心流程局部异常、高频操作失败、关键数据错误'
  WHEN 'L3' THEN '功能可继续使用，但存在普通流程异常或体验问题'
  WHEN 'L4' THEN '轻微样式、文案、提示、兼容性或低影响问题'
  ELSE `description`
END,
`updatedAt` = NOW(3)
WHERE `code` IN ('L1', 'L2', 'L3', 'L4');
