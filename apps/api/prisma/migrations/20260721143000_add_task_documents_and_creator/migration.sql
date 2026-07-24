ALTER TABLE `DevTask` ADD COLUMN `createdById` INTEGER NULL;

CREATE TABLE `TaskDocument` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `taskId` INTEGER NOT NULL,
  `documentId` INTEGER NOT NULL,

  UNIQUE INDEX `TaskDocument_taskId_documentId_key`(`taskId`, `documentId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DevTask`
  ADD CONSTRAINT `DevTask_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `Person`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `TaskDocument`
  ADD CONSTRAINT `TaskDocument_taskId_fkey`
  FOREIGN KEY (`taskId`) REFERENCES `DevTask`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TaskDocument`
  ADD CONSTRAINT `TaskDocument_documentId_fkey`
  FOREIGN KEY (`documentId`) REFERENCES `ProjectDocument`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
