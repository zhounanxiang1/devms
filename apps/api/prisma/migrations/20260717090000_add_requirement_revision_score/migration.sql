ALTER TABLE `Requirement`
  ADD COLUMN `revisionType` ENUM('CHANGE', 'OPTIMIZATION') NULL AFTER `launchStatus`;
