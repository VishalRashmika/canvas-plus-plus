# #1 in the bottom tool bar lets make a new text detection mode.

in the bottom tool bar add a new tool. this tool should autodetect text when i handwrite it on the canvas from my graphic tablet. to begin with lets scope this down to lowercase letters only. use a system to write this. if i write hello hyperlike cahracter world then hyperlike character like should be replaced with a space between words. make this feature properly to handle text properly. with this feature while listening to a lecture i would like to take notes like i do with my physical notebook. try to make sure there are less bugs. if it is easy try to detect words together matching common words so i could cursive too it is not a requirement but it would increase the .accurasy of the overall system. after making this mode, remove the functionality of the shape enhance mode to detect character because having that feature in 2 tools would make it redundand.

# #2 in the normal draw tool (not enchance one) there is an issue when writing short things
when i try to keep a dot in that mode it did not work. fix that to handle short forms of drawings. 

# #3 in the tables that we get from the bottom tool bar bug in line breaks
when we import a table from the bottom tool bar and add a long sentence to a single cell it does not properly renders with line breaks that matches the table. it just renders the entire sentence in a single line overflowing the cell boundaries. fix this.

# #4 in the tables that we get from the bottom tool bar bug when adding new columns and row
when adding new columns and rows using the hovering buttons it is not smooth and sometimes it does nothing just flickers. fix this issue to give a smooth UX which will add new columns and rows properly.

# #5 arrows UI bug for triangles.
when making an arrow from a box to a triangle the arrow does not touch the traingle it limits itself to the square bounding box. which in UI view looks like the arrow is pointing at nothing. fix this issue and make arrows to traingles touch the triangle properly. 

# #6 in the pdf open in cavnas constant refresh bugs
when an pdf is opened in the canvas there is a small delay too. that is not a huge problem but after opening it it refreshes for every change that happens in the canvas even i drew a new line it refreshes. no need to refresh that many times. fix this issue and limit the refresh to only when opening the canvas after closing to make it more efficient. the constant refreshing makes the entire canvas laggy and slow

# #7 new feature: 
if we drew an arrow/line from a component to and empty space in the canvas make a small new popup menu askig what we want to attach to the end of the arrow. a node, traingle, table, sticky note, ... etc... if pressed esc just remove the popup and mek it point to the empty space at canvas. we have this feature in obsidian native canvas. try to recreate this feature like we have in that with additional features and behaviours.

# #8 make the draw/ free hand tool smooth (not the enhnace one)
make the draw/freehand tool more smooth right now if i draw a continous curvy line some parts are rendered as straight lines, and sometimes it lags. fix these issues and give a more smoother experience for this tool

# #9 sometimes the entire canvas lags.
bugfix: can you make the canvas more efficent sometimes the entire canvas lags making it hard to even do common fairly small activities. fix this issue.
