import Renderer from './renderer';
import Tile from './tile';

import type Game from '../game';
import type { ContextCallback } from './renderer';
import type { ClientTile, TransformedTile } from '@kaetram/common/types/map';

enum TileFlip {
    Horizontal,
    Vertical,
    Diagonal
}

interface RendererTile {
    relativeTileId: number;
    setWidth: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface RendererCell {
    dx: number;
    dy: number;
    width: number;
    height: number;
}

export default class Canvas extends Renderer {
    public animatedTiles: { [tileId: number | string]: Tile } = {};

    // Used for storing and caching tile information.
    private tiles: { [id: string]: RendererTile } = {};
    private cells: { [id: number]: RendererCell } = {};

    // Override for the context types
    private backContext: CanvasRenderingContext2D = this.background.getContext('2d')!;
    private foreContext: CanvasRenderingContext2D = this.foreground.getContext('2d')!;

    private drawingContexts = [this.backContext, this.foreContext];

    public constructor(game: Game) {
        super(game);

        this.allContexts.push(this.backContext, this.foreContext);
    }

    /**
     * Override for the resizing function where we also
     * handle clearing up the canvases and tiling.
     */

    public override resize(): void {
        super.resize();

        // Clear all the cells so they're redrawn.
        this.cells = {};
    }

    /**
     * Override for the rendering function. We do our Canvas2D rendering here.
     */

    public override render(): void {
        if (this.stopRendering) return;

        super.render();

        this.draw();
    }

    // ---------- Drawing Functions ----------

    /**
     * Background and foreground drawing function. Here we iterate
     * through all the tile visibles (every tile in the camera's view)
     * and draw them onto the foreground and background canvases depending
     * on the tileId's property (we compare to see if the tile id is that
     * of a high tile in the map).
     */

    private draw(): void {
        if (this.hasRenderedFrame()) return;

        this.clearDrawing();
        this.saveDrawing();

        // Draw the default background colour
        this.backContext.fillStyle = 'rgba(9, 10, 20, 1)';
        this.backContext.fillRect(0, 0, this.background.width, this.background.height);

        // Sets the view according to the camera.
        this.updateDrawingView();

        this.forEachVisibleTile((tile: ClientTile, index: number) => {
            let flips: number[] = this.getFlipped(tile as TransformedTile);

            // Extract the tileId from the animated region tile.
            if (flips.length > 0) tile = (tile as TransformedTile).tileId;

            // Determine the layer of the tile depending on if it is a high tile or not.
            let isHighTile = this.map.isHighTile(tile as number),
                animated = this.map.isAnimatedTile(tile as number),
                context = (
                    isHighTile ? this.foreContext : this.backContext
                ) as CanvasRenderingContext2D;

            // Only do the lighting logic if there is an overlay.
            if (this.game.overlays.hasOverlay()) {
                let isLightTile = this.map.isLightTile(tile as number);

                context = isLightTile ? (this.overlayContext as CanvasRenderingContext2D) : context;
            }

            // Draw animated tiles if the tile is animated and we're animating tiles.
            if (this.animateTiles && animated) this.drawAnimatedTile(tile as number, index, flips);
            else this.drawTile(context, tile as number, index, flips);
        });

        this.saveFrame();
        this.restoreDrawing();
    }

    /**
     * Given the index of the specified animated tile, we draw the tile contained at
     * that index. We first have to check whether the tile is a foreground tile or not.
     * @param tile The tileId of the tile we are drawing, used to access the animated tile.
     * @param index The index of the tile on the map.
     * @param flips An array containing transformations the tile will undergo.
     */

    private drawAnimatedTile(tile: number, index: number, flips: number[] = []): void {
        // No drawing if we aren't animating tiles.
        if (!this.animateTiles) return;

        /**
         * There are special animated tiles that have their own unique tileId given the fact
         * that they animate once. For these we want to separate them into their own object
         * and animate separately. Example of these are the tiles that function as doors.
         */

        let isDynamicallyAnimated = this.map.dynamicAnimatedTiles[index],
            identifier = isDynamicallyAnimated ? `${tile}-${index}` : tile;

        // Add the tile to the list of animated tiles if it is animated.
        if (!(identifier in this.animatedTiles))
            this.addAnimatedTile(tile as number, isDynamicallyAnimated ? index : -1);

        let animatedTile = this.animatedTiles[identifier];

        // The tile does not exist at the specified index.
        if (!animatedTile) return;

        // Update the last accessed time.
        animatedTile.lastAccessed = this.game.time;

        // Prevent double draws when drawing flipped animated tiles.
        if (flips.length === 0 && animatedTile.isFlipped) return;

        // Extract the context from the animated tile.
        let context = animatedTile.isHighTile ? this.foreContext : this.backContext;

        // Draw the tile given its context (determined when we initialize the tile).
        this.drawTile(context, animatedTile.id + 1, index, flips);
    }

    // ---------- Primitive Drawing Functions ----------

    /**
     * Draws a tile with a specified tileId, at a specified index. The flips
     * represent an array of transformations that the tile can undergo. If the
     * array is empty, then there are no transformations.
     * @param context The canvas that we are drawing the tile on.
     * @param tileId The tile id is used to extract the tile from the tileset.
     * @param cellId The cell id is the index of the tile in the map.
     * @param flips An array containing transformations the tile will undergo.
     */

    private drawTile(
        context: CanvasRenderingContext2D,
        tileId: number,
        index: number,
        flips: number[] = []
    ): void {
        if (tileId < 0) return;

        let tileset = this.map.getTilesetFromId(tileId);

        if (!tileset) return;

        /**
         * To prevent redrawing and reculating the same tile, we
         * cache the tileId in our list of tiles. These are heavy
         * calculations that we attempt to prevent from occurring
         * every frame. The same applies for the cells below.
         */

        if (!(tileId in this.tiles)) {
            let setWidth = tileset.width / this.tileSize,
                relativeTileId = tileId - tileset.firstGid;

            this.tiles[tileId] = {
                relativeTileId,
                setWidth,
                x: this.getX(relativeTileId + 1, setWidth) * this.tileSize,
                y: Math.floor(relativeTileId / setWidth) * this.tileSize,
                width: this.tileSize,
                height: this.tileSize
            };
        }

        /**
         * Cell cache is responsible for storing the position and dimensions of each individual
         * tile. This is used to avoid recalculating the delta x and y coordinates for each rendering
         * call. Instead we keep it here for the duration the tile is in the camera's view.
         */

        if (!(index in this.cells) || flips.length > 0)
            this.cells[index] = {
                dx: Math.ceil(this.getX(index + 1, this.map.width) * this.actualTileSize),
                dy: Math.ceil(Math.floor(index / this.map.width) * this.actualTileSize),
                width: Math.ceil(this.actualTileSize),
                height: Math.ceil(this.actualTileSize)
            };

        this.drawImage(context, tileset, this.tiles[tileId], this.cells[index], flips);
    }

    /**
     * Responsible for drawing an image at a specified tile index.
     * @param context The Canvas2D context we are drawing the image on.
     * @param image The image source to draw from (tileset).
     * @param tile The renderer tile containing information such as x, y, width, height, etc.
     * @param cell The renderer cell containing information such as dx, dy, width, height, flips.
     */

    private drawImage(
        context: CanvasRenderingContext2D,
        image: CanvasImageSource,
        tile: RendererTile,
        cell: RendererCell,
        flips: number[] = []
    ): void {
        let dx = 0,
            dy = 0,
            isFlipped = flips.length > 0;

        /**
         * A tile rotation or flip is a combination of horizontal
         * and vertical flips, with a transpose that rotates the tile
         * 90 degrees. A transpose in our case is a rotation, followed by
         * a horizontal flip. When a tile undergoes any transformation,
         * we use these combinations to change its drawing.
         */

        if (isFlipped) {
            ({ dx, dy } = cell);

            // Save the context when we begin tile translations.
            context.save();

            // Store our delta x if we need to transpose.
            let tempX = dx;

            // Iterate through every type of flip in our array.
            for (let index = 0; index < flips.length; index++)
                switch (flips[index]) {
                    case TileFlip.Horizontal: {
                        // Flip the context2d horizontally
                        dx = -dx - cell.width;
                        context.scale(-1, 1);

                        break;
                    }

                    case TileFlip.Vertical: {
                        // Flip the context2d vertically
                        dy = -dy - cell.height;
                        context.scale(1, -1);

                        break;
                    }

                    case TileFlip.Diagonal: {
                        // A diagonal flip is actually a transpose of 90deg clockwise.
                        context.rotate(Math.PI / 2);
                        context.translate(0, -cell.height);

                        (dx = dy), (dy = -tempX);

                        /**
                         * Explanation: After we perform a diagonal permutation (that is, we rotate the tile
                         * 90 degrees to the right, the horizontal and vertical flags become inverted). That is,
                         * performing a horizontal flip after rotating performs a vertical flip when observed
                         * in the rendering context. The following ensures that a horizontal flip is performed only
                         * when the next available flip is horizontal (essentially performing two horizontals in a row.)
                         */

                        if (flips[index + 1] === (TileFlip.Horizontal as number))
                            flips.push(TileFlip.Horizontal);
                        else flips.push(TileFlip.Vertical);

                        break;
                    }
                }
        }

        context.drawImage(
            image,
            tile.x, // Source X
            tile.y, // Source Y
            tile.width, // Source Width
            tile.height, // Source Height
            dx || cell.dx, // Destination X
            dy || cell.dy, // Destination Y
            cell.width, // Destination Width
            cell.height // Destination Height
        );

        if (isFlipped) context.restore();
    }

    // ---------- Rendering Functions ----------

    // ---------- Context Manipulation Functions ----------

    /**
     * Iterates through the drawing contexts (low and high tiles) and clears the entire frame.
     */

    private clearDrawing(): void {
        this.forEachDrawingContext(this.clearScreen);
    }

    /**
     * Iterates through just the drawing contexts (low and high tiles) and saves the current state.
     */

    private saveDrawing(): void {
        this.forEachDrawingContext((context: CanvasRenderingContext2D) => context.save());
    }

    /**
     * Iterates through just the drawing contexts (low and high tiles) and restores them.
     */

    private restoreDrawing(): void {
        this.forEachDrawingContext((context: CanvasRenderingContext2D) => context.restore());
    }

    /**
     * Iterates through the drawing contexts (used for tiling) and sets the camera position.
     */

    private updateDrawingView(): void {
        this.forEachDrawingContext((context: CanvasRenderingContext2D) =>
            this.setCameraView(context)
        );
    }

    /**
     * Used to synchronize all animated tiles under certain conditions. Generally whenever
     * we add a new tile we want to sync them in case there are animations that require
     * multiple tiles.
     */

    private resetAnimatedTiles(): void {
        // Reset the animation frame index for each animated tile.
        for (let tile in this.animatedTiles) this.animatedTiles[tile].animationIndex = 0;
    }

    /**
     * Creates a new animated tile object and adds the tile id to the list of animated tiles.
     * This ID is used by all tiles that share the same id but are at different positions.
     * @param tileId The tileId of the tile we are adding, this is not the tile index.
     */

    private addAnimatedTile(tileId: number, index = -1): void {
        let identifier = index === -1 ? tileId : `${tileId}-${index}`;

        // Create the tile and add it to the list of animated tiles.
        this.animatedTiles[identifier] = new Tile(
            tileId,
            index,
            this.map.getTileAnimation(tileId),
            false,
            this.map.isHighTile(tileId)
        );

        // Synchronize all the existing tiles after we add a new one.
        this.resetAnimatedTiles();
    }

    // ---------- Getters and Checkers ----------

    /**
     * Checks if a tile is a flipped tile and extracts
     * all the flags based on the tile data. Returns an
     * array containing all the flip flags.
     * @param tile The region tile we are checking.
     * @returns An array containing all flip flags in order.
     */

    public getFlipped(tile: TransformedTile): number[] {
        let flips: number[] = [];

        // Return empty if tile doesn't contain flip flags.
        if (!this.map.isFlipped(tile)) return flips;

        if (tile.v) flips.push(TileFlip.Vertical);
        if (tile.d) flips.push(TileFlip.Diagonal);
        if (tile.h) flips.push(TileFlip.Horizontal);

        return flips;
    }

    // ---------- Iterative Functions ----------

    /**
     * Iterates through all the drawing contexts (backContext and foreContext).
     * @param callback The context being iterated.
     */

    private forEachDrawingContext(callback: ContextCallback): void {
        for (let context in this.drawingContexts)
            callback(this.drawingContexts[context] as CanvasRenderingContext2D);
    }
}
