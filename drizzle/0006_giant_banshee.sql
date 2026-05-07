CREATE TABLE `textAnnotations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`pageNumber` int NOT NULL DEFAULT 1,
	`x` float NOT NULL,
	`y` float NOT NULL,
	`width` float NOT NULL DEFAULT 200,
	`height` float NOT NULL DEFAULT 80,
	`content` varchar(2000) NOT NULL DEFAULT 'Text',
	`fontSize` int NOT NULL DEFAULT 24,
	`textColor` varchar(7) NOT NULL DEFAULT '#000000',
	`bgColor` varchar(20) NOT NULL DEFAULT '#ffffff',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `textAnnotations_id` PRIMARY KEY(`id`)
);
