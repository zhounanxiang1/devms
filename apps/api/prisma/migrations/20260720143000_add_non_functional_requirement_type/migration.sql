INSERT INTO `Dictionary` (`type`, `code`, `name`, `description`, `isSystem`, `isActive`, `sort`, `createdAt`, `updatedAt`)
VALUES ('REQUIREMENT_TYPE', 'NON_FUNCTIONAL', '非功能需求', '用于技术优化、架构治理、性能稳定性、代码质量等无直接业务流程的需求场景。', true, true, 6, NOW(), NOW())
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `isSystem` = true,
  `isActive` = true,
  `sort` = VALUES(`sort`),
  `updatedAt` = NOW();
