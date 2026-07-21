{
  flakeRef,
  action,
  localPath ? "",
  configuration ? "",
  query ? "",
  option ? "",
  limit ? "20",
}:
let
  flake = builtins.getFlake flakeRef;

  knownConfigurationRoots = [
    "nixosConfigurations"
    "homeConfigurations"
    "darwinConfigurations"
    "nixOnDroidConfigurations"
  ];

  configurationsFor =
    root:
    if builtins.hasAttr root flake && builtins.isAttrs (builtins.getAttr root flake) then
      map (name: {
        id = "${root}.${name}";
        inherit name root;
        path = [
          root
          name
        ];
      }) (builtins.attrNames (builtins.getAttr root flake))
    else
      [ ];

  configurations = builtins.concatMap configurationsFor knownConfigurationRoots;

  getPath = path: builtins.foldl' (value: name: builtins.getAttr name value) flake path;

  selectedConfiguration =
    let
      matches = builtins.filter (
        candidate: candidate.id == configuration || candidate.name == configuration
      ) configurations;
      explicitPath = builtins.filter (part: builtins.isString part && part != "") (
        builtins.split "[.]" configuration
      );
    in
    if configuration == "" then
      if builtins.length configurations == 1 then
        builtins.head configurations
      else
        throw "nix_options: select a configuration; available configurations: ${
          builtins.concatStringsSep ", " (map (candidate: candidate.id) configurations)
        }"
    else if builtins.length matches == 1 then
      builtins.head matches
    else if builtins.length matches > 1 then
      throw "nix_options: configuration name '${configuration}' is ambiguous; use its full output path"
    else if builtins.length explicitPath >= 2 then
      {
        id = configuration;
        name = builtins.concatStringsSep "." (builtins.tail explicitPath);
        root = builtins.head explicitPath;
        path = explicitPath;
      }
    else
      throw "nix_options: unknown configuration '${configuration}'; available configurations: ${
        builtins.concatStringsSep ", " (map (candidate: candidate.id) configurations)
      }";

  configurationValue = getPath selectedConfiguration.path;
  options =
    if builtins.isAttrs configurationValue && configurationValue ? options then
      configurationValue.options
    else
      throw "nix_options: flake output '${selectedConfiguration.id}' does not expose an options attribute";

  upper = [
    "A"
    "B"
    "C"
    "D"
    "E"
    "F"
    "G"
    "H"
    "I"
    "J"
    "K"
    "L"
    "M"
    "N"
    "O"
    "P"
    "Q"
    "R"
    "S"
    "T"
    "U"
    "V"
    "W"
    "X"
    "Y"
    "Z"
  ];
  lower = [
    "a"
    "b"
    "c"
    "d"
    "e"
    "f"
    "g"
    "h"
    "i"
    "j"
    "k"
    "l"
    "m"
    "n"
    "o"
    "p"
    "q"
    "r"
    "s"
    "t"
    "u"
    "v"
    "w"
    "x"
    "y"
    "z"
  ];
  toLower = builtins.replaceStrings upper lower;

  queryTerms = builtins.filter (term: builtins.isString term && term != "") (
    builtins.split "[^a-z0-9]+" (toLower query)
  );

  matchesQuery =
    name:
    let
      lowered = toLower name;
    in
    builtins.all (term: builtins.match ".*${term}.*" lowered != null) queryTerms;

  flakeSource = toString (flake.outPath or "");
  displayFile =
    file:
    builtins.replaceStrings (if localPath != "" && flakeSource != "" then [ flakeSource ] else [ ]) (
      if localPath != "" && flakeSource != "" then [ localPath ] else [ ]
    ) (toString file);

  renderDoc =
    value:
    if builtins.isString value then
      value
    else if builtins.isAttrs value && value ? text && builtins.isString value.text then
      value.text
    else
      null;

  optionInfo = path: value: {
    inherit path;
    name = builtins.concatStringsSep "." path;
    description = if value ? description then renderDoc value.description else null;
    type =
      if value ? type && builtins.isAttrs value.type && value.type ? description then
        renderDoc value.type.description
      else
        null;
    declarations = map displayFile (value.declarations or [ ]);
    definitionLocations = map (definition: {
      file = displayFile definition.file;
    }) (value.definitionsWithLocations or [ ]);
    hasDefault = value ? default;
    hasExample = value ? example;
    readOnly = value.readOnly or false;
    internal = value.internal or false;
    visible = value.visible or true;
  };

  walkOptions =
    path: value:
    if builtins.isAttrs value && (value._type or null) == "option" then
      if matchesQuery (builtins.concatStringsSep "." path) then [ (optionInfo path value) ] else [ ]
    else if builtins.isAttrs value then
      builtins.concatLists (
        builtins.map (name: walkOptions (path ++ [ name ]) (builtins.getAttr name value)) (
          builtins.attrNames value
        )
      )
    else
      [ ];

  optionPath = builtins.filter (part: builtins.isString part && part != "") (
    builtins.split "[.]" option
  );
  inspected = builtins.tryEval (
    builtins.foldl' (
      value: name:
      if builtins.isAttrs value && builtins.hasAttr name value then
        builtins.getAttr name value
      else
        throw "missing option path"
    ) options optionPath
  );

  parsedLimit = builtins.fromJSON limit;
  take =
    count: values:
    if count <= 0 || values == [ ] then
      [ ]
    else
      [ (builtins.head values) ] ++ take (count - 1) (builtins.tail values);
  matches = walkOptions [ ] options;
in
if action == "configurations" then
  {
    inherit configurations;
  }
else if action == "search" then
  if query == "" then
    throw "nix_options: query is required for search"
  else
    {
      configuration = selectedConfiguration.id;
      results = take parsedLimit matches;
      total = builtins.length matches;
    }
else if action == "inspect" then
  if option == "" then
    throw "nix_options: option is required for inspect"
  else if
    !inspected.success
    || !builtins.isAttrs inspected.value
    || (inspected.value._type or null) != "option"
  then
    throw "nix_options: option '${option}' was not found in '${selectedConfiguration.id}'"
  else
    {
      configuration = selectedConfiguration.id;
      result = optionInfo optionPath inspected.value;
    }
else
  throw "nix_options: unsupported action '${action}'"
