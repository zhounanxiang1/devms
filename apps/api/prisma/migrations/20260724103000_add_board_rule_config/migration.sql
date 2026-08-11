CREATE TABLE `BoardRuleConfig` (
  `id` INTEGER NOT NULL,
  `dueSoonDays` INTEGER NOT NULL DEFAULT 2,
  `normalLoadLimit` INTEGER NOT NULL DEFAULT 5,
  `saturatedLoadLimit` INTEGER NOT NULL DEFAULT 10,
  `staleProjectDays` INTEGER NOT NULL DEFAULT 7,
  `highPriorityThreshold` DOUBLE NOT NULL DEFAULT 40,
  `includeClosedItems` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `BoardRuleConfig` (`id`, `dueSoonDays`, `normalLoadLimit`, `saturatedLoadLimit`, `staleProjectDays`, `highPriorityThreshold`, `includeClosedItems`, `updatedAt`)
VALUES (1, 2, 5, 10, 7, 40, false, CURRENT_TIMESTAMP(3));
