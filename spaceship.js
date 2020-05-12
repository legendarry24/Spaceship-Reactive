const canvas = document.createElement('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const ctx = canvas.getContext('2d');
document.body.appendChild(canvas);

/* Constants */
const GAME_SPEED = 40;
const SHOOTING_FREQ = 200;
const SHOOTING_SPEED = 15;
const ENEMY_FREQ = 1500;
const SCORE_INCREASE = 10;
const HERO_Y = canvas.height - 30;

/* Helper functions */
function getRandomInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getTimeDiffInSeconds(prevTimestamp, currTimestamp) {
	return Math.floor((currTimestamp-prevTimestamp) / 1000);
}

function colision(target1, target2) {
	return (
		target1.x > target2.x - 20 &&
		target1.x < target2.x + 20 &&
		target1.y > target2.y - 20 &&
		target1.y < target2.y + 20
	);
}

function drawTriangle(x, y, width, color, direction) {
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.moveTo(x - width, y);
	ctx.lineTo(x, direction === 'up' ? y - width : y + width);
	ctx.lineTo(x + width, y);
	ctx.lineTo(x - width, y);
	ctx.fill();
}

function paintStars(stars) {
	ctx.fillStyle = '#000000';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = '#ffffff';
	stars.forEach(function (star) {
		ctx.fillRect(star.x, star.y, star.size, star.size);
	});
}

function paintSpaceShip(spaceship) {
	drawTriangle(spaceship.x, spaceship.y, 20, '#00ff00', 'up');
}

function paintEnemies(enemies) {
	enemies.forEach(function (enemy) {
		enemy.y += 5;
		enemy.x += getRandomInt(-15, 15);

		if (!enemy.isDead) {
			drawTriangle(enemy.x, enemy.y, 20, '#ff0000', 'down');
		}

		enemy.shots.forEach(function (shot) {
			shot.y += SHOOTING_SPEED;
			drawTriangle(shot.x, shot.y, 5, '#00ffff', 'down');
		});
	});
}

function paintScore(score) {
	ctx.fillStyle = '#ffffff';
	ctx.font = 'bold 26px sans-serif';
	ctx.fillText('Score: ' + score, 40, 43);
}

function isVisible(obj) {
	return (
		obj.x > -40 &&
		obj.x < canvas.width + 40 &&
		obj.y > -40 &&
		obj.y < canvas.height + 40
	);
}

function paintHeroShots(heroShots, enemies) {
	heroShots.forEach((shot, i) => {
		var impact = false;
		for (var l = 0; l < enemies.length; l++) {
			var enemy = enemies[l];
			if (!enemy.isDead && colision(shot, enemy)) {
				ScoreSubject.onNext(SCORE_INCREASE);
				enemy.isDead = true;
				shot.x = shot.y = -100;
				impact = true;
				break;
			}
		}

		if (!impact) {
			shot.y -= SHOOTING_SPEED;
			drawTriangle(shot.x, shot.y, 5, '#ffff00', 'up');
		}
	});
}

function gameOver(player, enemies) {
	return enemies.some(enemy => {
		if (colision(player, enemy)) {
			return true;
		}

		return enemy.shots.some(shot => colision(player, shot));
	});
}

function renderScene(actors) {
	paintStars(actors.stars);
	paintSpaceShip(actors.spaceship);
	paintEnemies(actors.enemies);
	paintHeroShots(actors.heroShots, actors.enemies);
	paintScore(actors.score);
}

/* Reactive code */

const StarStream = Rx.Observable
	.range(1, 250)
	.map(() => ({
			x: parseInt(Math.random() * canvas.width),
			y: parseInt(Math.random() * canvas.height),
			size: Math.random() * 3 + 1
		})
	)
	.toArray()
	.flatMap(arr =>
		Rx.Observable
			.interval(GAME_SPEED)
			.map(() =>
				arr.map(star => {
					if (star.y >= canvas.height) {
						star.y = 0;
					}
					star.y += star.size;
					return star;
				})
			)
	);

const mouseMove = Rx.Observable.fromEvent(canvas, 'mousemove');
const SpaceShip = mouseMove
	.map(event => ({
		x: event.clientX,
		y: HERO_Y
	}))
	.startWith({
		x: canvas.width / 2,
		y: HERO_Y
	});

const playerFiring = Rx.Observable
	.merge(
		Rx.Observable.fromEvent(canvas, 'click'),
		Rx.Observable
			.fromEvent(document, 'keydown')
			.filter((event) => event.keyCode === 32 || event.keyCode === 13)
	)
	.startWith({})
	.sample(SHOOTING_FREQ)
	.timestamp();

const HeroShots = Rx.Observable
	.combineLatest(
		playerFiring,
		SpaceShip,
		(shotEvents, spaceShip) => ({
			timestamp: shotEvents.timestamp,
			spaceShipX: spaceShip.x
		})
	)
	// we use distinctUntilChanged instead of distinct because it is enough for our case.
	// It also saves us from the higher memory usage of distinct;
	// distinct needs to keep all the previous results in memory.
	.distinctUntilChanged(shot => shot.timestamp)
	.scan((shotArray, shot) => {
			shotArray.push({
				x: shot.spaceShipX,
				y: HERO_Y
			});
			return shotArray.filter(isVisible);
		}, []
	);

const Enemies = Rx.Observable
	.interval(ENEMY_FREQ)
	.scan(enemyArray => {
		var enemy = {
			x: parseInt(Math.random() * canvas.width),
			y: -30,
			shots: []
		};

		Rx.Observable
			.interval(getRandomInt(700, 800))
			.subscribe(() => {
				if (!enemy.isDead) {
					enemy.shots.push({ x: enemy.x, y: enemy.y });
				}
				enemy.shots = enemy.shots.filter(isVisible);
			});

		enemyArray.push(enemy);
		return enemyArray
			.filter(enemy =>
				isVisible(enemy) && !(enemy.isDead && enemy.shots.length === 0)
			);
		}, []);

const ScoreSubject = new Rx.BehaviorSubject(0);
// we use scan without optional seed param because we get initial value from BehaviorSubject
const Score = ScoreSubject
	.timestamp()
	.scan((prev, curr) => {
		const bonusScore = getTimeDiffInSeconds(prev.timestamp, curr.timestamp) < 3
			? 5
			: 0;

		return {
			value: prev.value + curr.value + bonusScore,
			timestamp: curr.timestamp
		};
	});

const Game = Rx.Observable
	.combineLatest(
		StarStream,
		SpaceShip,
		Enemies,
		HeroShots,
		Score,
		(stars, spaceship, enemies, heroShots, score) => ({
			stars: stars,
			spaceship: spaceship,
			enemies: enemies,
			heroShots: heroShots,
			score: score.value
		})
	)
	.sample(GAME_SPEED)
	.takeWhile(actors => !gameOver(actors.spaceship, actors.enemies));

Game.subscribe(renderScene);
