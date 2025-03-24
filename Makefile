.PHONY: build up upd down down++

build:
	docker-compose build && docker-compose up 

up:
	docker-compose up 

upd:
	docker-compose up -d

down:
	docker-compose down

down++:
	docker-compose down --volumes --remove-orphans


